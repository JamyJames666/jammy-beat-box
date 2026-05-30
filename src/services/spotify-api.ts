import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import type {Track as SpotifyUrlInfoTrack} from 'spotify-url-info';
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

    // ── Attempt 1: Spotify Web API (Client Credentials) ────────────────────
    // Use loose != null so both null and undefined track entries are filtered.
    const onlyTracks = (items: Array<SpotifyApi.TrackObjectFull | SpotifyApi.EpisodeObject | null | undefined>) =>
      items.filter((t): t is SpotifyApi.TrackObjectFull => t !== null && t !== undefined && t.type === 'track');

    try {
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
      } catch {
        const {body: firstPage} = await this.spotify.getPlaylistTracks(uri.id, {limit: 50});
        tracksResponse = firstPage;
        playlistTitle = 'Spotify Playlist';
        playlistHref = `https://open.spotify.com/playlist/${uri.id}`;
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
        throw new Error('empty');
      }

      return [this.limitTracks(items, playlistLimit).map(t => this.toSpotifyTrack(t, t.album?.images?.[0]?.url ?? null)), playlist];
    } catch {
      // ── Attempt 2: spotify-url-info (scrapes Spotify web player, no auth) ──
      return this.getPlaylistViaUrlInfo(url, playlistLimit);
    }
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
      this.toSpotifyTrack(t, (t).album?.images?.[0]?.url ?? null),
    );
  }

  private async getPlaylistViaUrlInfo(url: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    // The package's default export is declared as an interface (type-only in TS)
    // but at runtime it is a callable factory function.
    type UrlInfoFactory = (f: typeof fetch) => {
      getData: (url: string) => Promise<{name?: string}>;
      getTracks: (url: string) => Promise<SpotifyUrlInfoTrack[]>;
    };
    const mod = await import('spotify-url-info') as unknown as {default: UrlInfoFactory};
    const {getData, getTracks} = mod.default(fetch);

    const [data, rawTracks] = await Promise.all([
      getData(url) as Promise<{name?: string}>,
      getTracks(url),
    ]);

    if (!rawTracks || rawTracks.length === 0) {
      throw new Error('No playable tracks found in this Spotify playlist. It may be private or empty.');
    }

    // Return tracks immediately — no blocking thumbnail fetch.
    // Awaiting this.spotify.getTracks() caused playlists to hang when the
    // Client Credentials token was expired or rate-limited.
    const tracks: SpotifyTrack[] = rawTracks.map(t => ({
      name: t.name,
      artist: t.artist ?? '',
      durationSeconds: Math.round((t.duration ?? 0) / 1000),
      thumbnailUrl: null,
    }));

    const playlist = {
      title: data.name ?? 'Spotify Playlist',
      source: url,
    };

    return [this.limitTracks(tracks, playlistLimit), playlist];
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
