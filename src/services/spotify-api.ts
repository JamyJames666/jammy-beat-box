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

    // ── Attempt 1: raw HTTP token grant → bypasses spotify-web-api-node ───
    // clientCredentialsGrant() in the library silently swallows errors;
    // a direct POST to Spotify's token endpoint is simpler and more debuggable.
    const clientId = this.spotify.getClientId();
    const clientSecret = this.spotify.getClientSecret();
    if (clientId && clientSecret) {
      try {
        const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRaw = await got('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${creds}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
          timeout: {request: 10_000},
        }).text();
        const tokenData = JSON.parse(tokenRaw) as {access_token?: string};
        const clientToken = tokenData.access_token;

        if (clientToken) {
          const metaRaw = await got(
            `https://api.spotify.com/v1/playlists/${uri.id}?fields=name,href`,
            {headers: {Authorization: `Bearer ${clientToken}`}, timeout: {request: 10_000}},
          ).text();
          const meta = JSON.parse(metaRaw) as {name?: string; href?: string};

          const tracks = await this.paginatePlaylist(clientToken, uri.id, playlistLimit);
          if (tracks.length > 0) {
            return [tracks, {title: meta.name ?? 'Spotify Playlist', source: meta.href ?? url}];
          }
        }
      } catch {
        // Fall through to embed scrape
      }
    }

    // ── Attempt 2: scrape Spotify embed page directly (no auth required) ──
    return this.getPlaylistViaEmbed(uri.id, url, playlistLimit);
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
    const embedToken: string | null
      // 1. Various JSON paths Spotify has used across embed versions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      = (pageData?.props?.pageProps?.accessToken as string | undefined)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ?? (pageData?.props?.pageProps?.state?.session?.accessToken as string | undefined)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ?? (pageData?.props?.pageProps?.state?.data?.accessToken as string | undefined)
      // 2. Regex over the full __NEXT_DATA__ JSON string
      ?? (/"accessToken":"([^"]+)"/.exec(match[1])?.[1])
      // 3. Regex over the entire HTML (token sometimes lives outside __NEXT_DATA__)
      ?? (/"accessToken":"([^"]+)"/.exec(html)?.[1])
      ?? null;

    // Only bother paginating if the playlist likely has more than the embed returned.
    // Check the total track count from the API first so we know what we're dealing with.
    const tokenToUse = embedToken ?? await this.getAnonymousToken(BROWSER_UA);

    if (tokenToUse) {
      try {
        const firstPageRaw = await got(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=1&offset=0`,
          {headers: {Authorization: `Bearer ${tokenToUse}`}, timeout: {request: 8_000}},
        ).text();
        const firstPage = JSON.parse(firstPageRaw) as {total?: number};
        const totalInPlaylist = firstPage.total ?? 0;

        if (totalInPlaylist > entity.trackList.length) {
          // Playlist has more songs than the embed returned — paginate the full list
          const paginated = await this.paginateWithEmbedToken(tokenToUse, playlistId, Math.min(playlistLimit, totalInPlaylist));
          if (paginated.length > tracks.length) {
            tracks = paginated;
          }
        }
        // If totalInPlaylist <= embed count, the embed already gave us everything
      } catch {
        // Could not check total — attempt pagination anyway as a best-effort
        const paginated = await this.paginateWithEmbedToken(tokenToUse, playlistId, playlistLimit);
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
      const rawCookies: string[] = (homeRes.headers['set-cookie']) ?? [];
      const cookieHeader = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

      const raw = await got(
        'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
        {
          headers: {
            'User-Agent': userAgent,
            Accept: 'application/json',
            Cookie: cookieHeader,
          },
          timeout: {request: 8_000},
        },
      ).text();
      return (JSON.parse(raw) as {accessToken?: string}).accessToken ?? null;
    } catch {
      return null;
    }
  }

  // Offset-based pagination — per-page error handling so one failed page
  // doesn't lose all previously collected tracks.
  private async paginatePlaylist(token: string, playlistId: string, limit: number): Promise<SpotifyTrack[]> {
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
    const PAGE_SIZE = 50;
    let offset = 0;

    while (tracks.length < limit) {
      let page: {items: PageItem[]; next: string | null; total: number} | null = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await got(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${PAGE_SIZE}&offset=${offset}`,
          {headers, timeout: {request: 10_000}},
        ).text();
        page = JSON.parse(raw) as {items: PageItem[]; next: string | null; total: number};
      } catch {
        break;
      }

      if (!page?.items) {
        break;
      }

      let added = 0;
      for (const item of page.items) {
        if (item.track && item.track.type === 'track') {
          tracks.push({
            name: item.track.name,
            artist: item.track.artists[0]?.name ?? '',
            durationSeconds: Math.round((item.track.duration_ms ?? 0) / 1000),
            thumbnailUrl: item.track.album?.images?.[0]?.url ?? null,
          });
          added++;
        }
      }

      offset += PAGE_SIZE;
      // Stop if: no next page, received fewer than PAGE_SIZE items, or nothing useful this page
      if (!page.next || page.items.length < PAGE_SIZE || added === 0) {
        break;
      }

      // Small pause to avoid hitting Spotify rate limits
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(resolve => {
        setTimeout(resolve, 150);
      });
    }

    return tracks;
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

    interface TracksPage {
      items: PageItem[];
      next: string | null;
      total?: number;
    }

    const tracks: SpotifyTrack[] = [];
    const headers = {Authorization: `Bearer ${token}`};
    let offset = 0;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;

    while (tracks.length < limit) {
      const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&offset=${offset}`;
      let body: TracksPage | null = null;

      // Retry with backoff on rate-limit (429) — up to MAX_FAILURES times
      for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const raw = await got(url, {headers, timeout: {request: 12_000}}).text();
          body = JSON.parse(raw) as TracksPage;
          consecutiveFailures = 0;
          break;
        } catch (err: unknown) {
          const status = (err as {response?: {statusCode?: number}}).response?.statusCode;
          if (status === 429 && attempt < MAX_FAILURES - 1) {
            // Rate limited — wait progressively longer before retrying
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>(resolve => {
              setTimeout(resolve, (attempt + 1) * 2000);
            });
          } else {
            consecutiveFailures++;
            break;
          }
        }
      }

      if (!body?.items || consecutiveFailures >= MAX_FAILURES) {
        break;
      }

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

      // Stop if this is the last page or we've hit the limit
      if (!body.next || body.items.length === 0 || tracks.length >= limit) {
        break;
      }

      offset += 50;
      // Polite delay between pages
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(resolve => {
        setTimeout(resolve, 300);
      });
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
