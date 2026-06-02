import {URL} from 'url';
import {inject, injectable} from 'inversify';
import * as spotifyURI from 'spotify-uri';
import Spotify from 'spotify-web-api-node';
import got from 'got';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';
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
      // ── Attempt 2: scrape Spotify embed page directly (no auth required) ──
      return this.getPlaylistViaEmbed(uri.id, url, playlistLimit);
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

  private async getPlaylistViaEmbed(playlistId: string, originalUrl: string, playlistLimit: number): Promise<[SpotifyTrack[], QueuedPlaylist]> {
    interface EmbedTrack {
      uri?: string;
      title?: string;
      subtitle?: string;
      duration?: number;
    }

    interface EmbedEntity {
      name?: string;
      title?: string;
      trackList?: EmbedTrack[];
    }

    const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const html = await got(`https://open.spotify.com/embed/playlist/${playlistId}`, {
      headers: {'User-Agent': BROWSER_UA},
      timeout: {request: 15_000},
    }).text();

    const match = /<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/.exec(html);
    if (!match) {
      throw new Error('Could not load Spotify playlist — embed page format may have changed.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pageData = JSON.parse(match[1]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const entity = pageData?.props?.pageProps?.state?.data?.entity as EmbedEntity | undefined;

    if (!entity?.trackList?.length) {
      throw new Error('No playable tracks found in this Spotify playlist. It may be private or empty.');
    }

    // Baseline: embed trackList (~100 tracks, no thumbnails)
    let tracks: SpotifyTrack[] = entity.trackList.map(t => ({
      name: t.title ?? '',
      artist: t.subtitle ?? '',
      durationSeconds: Math.round((t.duration ?? 0) / 1000),
      thumbnailUrl: null,
    }));

    // Try several token sources in order of reliability.
    // Any valid token lets us call the real Spotify API for the full list.
    const embedToken: string | null =
      // 1. Various JSON paths Spotify has used across embed versions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (pageData?.props?.pageProps?.accessToken as string | undefined) ??
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (pageData?.props?.pageProps?.state?.session?.accessToken as string | undefined) ??
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (pageData?.props?.pageProps?.state?.data?.accessToken as string | undefined) ??
      // 2. Regex over the full __NEXT_DATA__ JSON string
      (/"accessToken":"([^"]+)"/.exec(match[1])?.[1]) ??
      // 3. Regex over the entire HTML (token sometimes lives outside __NEXT_DATA__)
      (/"accessToken":"([^"]+)"/.exec(html)?.[1]) ??
      null;

    if (embedToken) {
      const paginated = await this.paginateWithEmbedToken(embedToken, playlistId, playlistLimit);
      if (paginated.length > tracks.length) {
        tracks = paginated;
      }
    }

    // If still only have embed tracks, try the anonymous Spotify web-player token
    // endpoint — returns a short-lived public token, no credentials needed.
    if (tracks.length <= entity.trackList.length) {
      const anonToken = await this.getAnonymousToken(BROWSER_UA);
      if (anonToken) {
        const paginated = await this.paginateWithEmbedToken(anonToken, playlistId, playlistLimit);
        if (paginated.length > tracks.length) {
          tracks = paginated;
        }
      }
    }

    const playlist = {
      title: entity?.name ?? entity?.title ?? 'Spotify Playlist',
      source: originalUrl,
    };

    return [this.limitTracks(tracks, playlistLimit), playlist];
  }

  private async getAnonymousToken(userAgent: string): Promise<string | null> {
    try {
      // Spotify requires the sp_t session cookie — get it by hitting the main page first.
      const homeRes = await got('https://open.spotify.com/', {
        headers: {'User-Agent': userAgent},
        timeout: {request: 10_000},
        followRedirect: true,
      });
      const rawCookies: string[] = (homeRes.headers['set-cookie'] as string[] | undefined) ?? [];
      const cookieHeader = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

      const raw = await got(
        'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
        {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/json',
            'Cookie': cookieHeader,
          },
          timeout: {request: 8_000},
        },
      ).text();
      return (JSON.parse(raw) as {accessToken?: string}).accessToken ?? null;
    } catch {
      return null;
    }
  }

  private async paginateWithEmbedToken(token: string, playlistId: string, limit: number): Promise<SpotifyTrack[]> {
    interface PageItem {
      track: {
        name: string;
        type: string;
        duration_ms: number;
        artists: Array<{name: string}>;
        album: {images: Array<{url: string}>};
      } | null;
    }

    const tracks: SpotifyTrack[] = [];
    const headers = {Authorization: `Bearer ${token}`};
    let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&offset=0`;

    try {
      while (nextUrl !== null && tracks.length < limit) {
        // eslint-disable-next-line no-await-in-loop
        const raw = await got(nextUrl, {headers, timeout: {request: 10_000}}).text();
        const body = JSON.parse(raw) as {items: PageItem[]; next: string | null};
        for (const item of body.items) {
          if (item.track && item.track.type === 'track') {
            tracks.push({
              name: item.track.name,
              artist: item.track.artists[0]?.name ?? '',
              durationSeconds: Math.round((item.track.duration_ms ?? 0) / 1000),
              thumbnailUrl: item.track.album?.images?.[0]?.url ?? null,
            });
          }
        }

        nextUrl = tracks.length < limit ? (body.next ?? null) : null;
        if (nextUrl !== null) {
          // Small pause between pages to avoid hitting Spotify's rate limit
          // eslint-disable-next-line no-await-in-loop
          await new Promise<void>(resolve => {
            setTimeout(resolve, 200);
          });
        }
      }
    } catch {
      // Token expired or rate-limited — return whatever we collected
    }

    return tracks;
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
    // Take the first N in playlist order — user can shuffle from the web dashboard.
    return tracks.length > limit ? tracks.slice(0, limit) : tracks;
  }
}
