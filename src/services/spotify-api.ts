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
    // Fetch Spotify's embed page directly with a browser User-Agent.
    // The page embeds all track data as __NEXT_DATA__ JSON — no auth required.
    // spotify-url-info did the same thing but stopped working because it
    // didn't send a User-Agent header, causing Spotify to return a different page.
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

    const html = await got(`https://open.spotify.com/embed/playlist/${playlistId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
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

    // The embed gives the first ~100 tracks AND an anonymous access token
    // that can call the real Spotify API for the full paginated list.
    // Extract that token from __NEXT_DATA__ and use it with got directly.
    const tokenMatch = /"accessToken":"([^"]+)"/.exec(match[1]);
    const embedToken = tokenMatch?.[1] ?? null;

    // Start with embed tracks as the baseline (~100, no thumbnails)
    let tracks: SpotifyTrack[] = entity.trackList.map(t => ({
      name: t.title ?? '',
      artist: t.subtitle ?? '',
      durationSeconds: Math.round((t.duration ?? 0) / 1000),
      thumbnailUrl: null,
    }));

    // The __NEXT_DATA__ includes an anonymous access token Spotify's embed
    // player uses to paginate tracks. Use it to fetch the full list via the
    // official API — gets thumbnails and bypasses the ~100-track embed cap.
    if (embedToken) {
      const paginated = await this.paginateWithEmbedToken(embedToken, playlistId, playlistLimit);
      if (paginated.length > 0) {
        tracks = paginated;
      }
    }

    const playlist = {
      title: entity.name ?? entity.title ?? 'Spotify Playlist',
      source: originalUrl,
    };

    return [this.limitTracks(tracks, playlistLimit), playlist];
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
