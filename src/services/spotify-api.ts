import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
import shuffle from 'array-shuffle';
import {QueuedPlaylist} from './player.js';

export interface SpotifyTrack {
  name: string;
  artist: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

@injectable()
export default class {
  private readonly spotify: Spotify;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.spotify = thirdParty.spotify;
  }

  async getAlbum(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Album;
    const [{body: album}, {body: {items}}] = await Promise.all([this.spotify.getAlbum(uri.id), this.spotify.getAlbumTracks(uri.id, {limit: 50})]);
    const albumThumbnail = album.images[0]?.url ?? null;
    const tracks = this.limitTracks(items, playlistLimit).map(t => this.toSpotifyTrack(t, albumThumbnail));
    const playlist = {title: album.name, source: album.href};

    return [tracks, playlist];
  }

  async getPlaylist(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Playlist;

    // Use loose != null to catch both null and undefined track entries
    // (the Spotify API can return undefined for unavailable/local tracks
    // even though the TypeScript types only declare null)
    const onlyTracks = (items: Array<SpotifyApi.TrackObjectFull | SpotifyApi.EpisodeObject | null | undefined>) =>
      items.filter((t): t is SpotifyApi.TrackObjectFull => t != null && t.type === 'track');

    // Fetch playlist metadata and first page of tracks in parallel.
    // If getPlaylist itself throws (e.g. private playlist) we still want
    // to surface the real error so fall through naturally.
    let playlistTitle: string;
    let playlistHref: string;
    let tracksResponse: SpotifyApi.PagingObject<SpotifyApi.PlaylistTrackObject>;

    try {
      const [{body: playlistResponse}, {body: firstPage}] = await Promise.all([
        this.spotify.getPlaylist(uri.id),
        this.spotify.getPlaylistTracks(uri.id, {limit: 50}),
      ]);
      playlistTitle = playlistResponse.name;
      playlistHref = playlistResponse.href;
      tracksResponse = firstPage;
    } catch (error: unknown) {
      // getPlaylist() might 403 for private playlists; fall back to tracks-only
      const {body: firstPage} = await this.spotify.getPlaylistTracks(uri.id, {limit: 50});
      tracksResponse = firstPage;
      playlistTitle = 'Spotify Playlist';
      playlistHref = `https://open.spotify.com/playlist/${uri.id}`;
      void error; // suppress unused-var lint
    }

    const playlist = {title: playlistTitle, source: playlistHref};
    const items = onlyTracks(tracksResponse.items.map(i => i.track));

    while (tracksResponse.next) {
      // eslint-disable-next-line no-await-in-loop
      ({body: tracksResponse} = await this.spotify.getPlaylistTracks(uri.id, {
        limit: parseInt(new URL(tracksResponse.next).searchParams.get('limit') ?? '50', 10),
        offset: parseInt(new URL(tracksResponse.next).searchParams.get('offset') ?? '0', 10),
      }));

      items.push(...onlyTracks(tracksResponse.items.map(i => i.track)));
    }

    if (items.length === 0) {
      throw new Error('No playable tracks found in this Spotify playlist. It may be private, empty, or region-restricted.');
    }

    const tracks = this.limitTracks(items, playlistLimit).map(t => {
      const thumbnail = t.album?.images?.[0]?.url ?? null;
      return this.toSpotifyTrack(t, thumbnail);
    });

    return [tracks, playlist];
  }

  async getTrack(url: string): Promise<SpotifyTrack> {
    const uri = spotifyURI.parse(url) as spotifyURI.Track;
    const {body} = await this.spotify.getTrack(uri.id);

    return this.toSpotifyTrack(body, body.album?.images?.[0]?.url ?? null);
  }

  async getArtist(url: string, playlistLimit: number): Promise<SpotifyTrack[]> {
    const uri = spotifyURI.parse(url) as spotifyURI.Artist;
    const {body} = await this.spotify.getArtistTopTracks(uri.id, 'US');

    return this.limitTracks(body.tracks, playlistLimit).map(t =>
      this.toSpotifyTrack(t, (t as SpotifyApi.TrackObjectFull).album?.images?.[0]?.url ?? null),
    );
  }

  private toSpotifyTrack(track: SpotifyApi.TrackObjectSimplified, thumbnailUrl: string | null = null): SpotifyTrack {
    return {
      name: track.name,
      artist: track.artists[0].name,
      durationSeconds: Math.round((track.duration_ms ?? 0) / 1000),
      thumbnailUrl,
    };
  }

  private limitTracks<T>(tracks: T[], limit: number): T[] {
    return tracks.length > limit ? shuffle(tracks).slice(0, limit) : tracks;
  }
}
