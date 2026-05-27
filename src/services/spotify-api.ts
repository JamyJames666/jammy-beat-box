import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import got from 'got';
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
      items.filter((t): t is SpotifyApi.TrackObjectFull => t != null && t.type === 'track');

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
      // ── Attempt 2: Spotify anonymous web-player token ───────────────────────
      // Spotify's own web player fetches a guest token from this endpoint for
      // every unauthenticated page load. It grants read access to public
      // playlist data via the official API without requiring OAuth or a
      // registered Spotify app with elevated quotas.
      return this.getPlaylistViaWebToken(uri.id, url, playlistLimit);
    }
  }

  /**
   * Fetch a public Spotify playlist using the anonymous guest token that
   * Spotify's web player issues to unauthenticated visitors.
   * Endpoint: https://open.spotify.com/get_access_token?reason=transport&productType=web_player
   */
  private async getPlaylistViaWebToken(playlistId: string, originalUrl: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    // 1. Obtain anonymous guest token
    const tokenResp = await got('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      timeout: {request: 10_000},
    }).json<{accessToken?: string}>();

    const token = tokenResp.accessToken;
    if (!token) {
      throw new Error('Could not obtain Spotify anonymous token — the playlist may be private.');
    }

    // Types for the raw API responses we care about
    interface RawTrack {
      name: string;
      type: string;
      duration_ms: number;
      artists: Array<{name: string}>;
      album: {name: string; images: Array<{url: string}>};
    }

    interface TracksPage {
      items: Array<{track: RawTrack | null}>;
      next: string | null;
    }

    interface PlaylistMeta {
      name: string;
      href: string;
    }

    const headers = {Authorization: `Bearer ${token}`};

    // 2. Fetch playlist name + first track page in parallel
    const [meta, firstPage] = await Promise.all([
      got(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name,href`, {headers}).json<PlaylistMeta>(),
      got(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`, {headers}).json<TracksPage>(),
    ]);

    const rawItems = [...firstPage.items];
    let nextUrl = firstPage.next;
    while (nextUrl) {
      // eslint-disable-next-line no-await-in-loop
      const page = await got(nextUrl, {headers}).json<TracksPage>();
      rawItems.push(...page.items);
      nextUrl = page.next;
    }

    const tracks: SpotifyTrack[] = rawItems
      .filter(i => i.track !== null && i.track.type === 'track')
      .map(i => ({
        name: i.track!.name,
        artist: i.track!.artists[0]?.name ?? '',
        durationSeconds: Math.round((i.track!.duration_ms ?? 0) / 1000),
        thumbnailUrl: i.track!.album.images[0]?.url ?? null,
      }));

    if (tracks.length === 0) {
      throw new Error('No playable tracks found in this Spotify playlist. It may be private or empty.');
    }

    const playlist = {title: meta.name ?? 'Spotify Playlist', source: meta.href ?? originalUrl};
    return [this.limitTracks(tracks, playlistLimit), playlist];
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
