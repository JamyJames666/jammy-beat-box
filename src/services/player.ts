import {VoiceChannel, Snowflake} from 'discord.js';
import {Readable} from 'stream';
import {setTimeout as sleep} from 'timers/promises';
import hasha from 'hasha';
import {WriteStream} from 'fs-capacitor';
import ffmpeg from 'fluent-ffmpeg';
import shuffle from 'array-shuffle';
import {
  AudioPlayer,
  AudioPlayerState,
  AudioPlayerStatus, AudioResource,
  createAudioPlayer,
  createAudioResource, DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import FileCacheProvider from './file-cache.js';
import debug from '../utils/debug.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';
import {getYouTubeMediaSource, createYtDlpAudioStream, searchWithYtDlp} from '../utils/yt-dlp.js';
import {Setting} from '@prisma/client';
import https from 'https';

export enum MediaSource {
  Youtube,
  HLS,
}

export interface QueuedPlaylist {
  title: string;
  source: string;
}

export interface SongMetadata {
  title: string;
  artist: string;
  url: string; // For YT, it's the video ID (not the full URI)
  length: number;
  offset: number;
  playlist: QueuedPlaylist | null;
  isLive: boolean;
  thumbnailUrl: string | null;
  source: MediaSource;
}
export interface QueuedSong extends SongMetadata {
  addedInChannelId: Snowflake;
  requestedBy: string;
}

export enum STATUS {
  PLAYING,
  PAUSED,
  IDLE,
}

export interface PlayerEvents {
  statusChange: (oldStatus: STATUS, newStatus: STATUS) => void;
}

export const DEFAULT_VOLUME = 100;

export type AudioEffect = 'none' | 'bass' | 'treble' | 'reverb' | '8d' | 'nightcore' | 'vaporwave';

export const AUDIO_EFFECT_FILTERS: Record<AudioEffect, string[]> = {
  none: [],
  bass: ['bass=g=10'],
  treble: ['treble=g=8'],
  reverb: ['aecho=0.8:0.88:60|69:0.4|0.3'],
  '8d': ['apulsator=hz=0.08'],
  nightcore: ['asetrate=48000*1.25', 'aresample=48000'],
  vaporwave: ['asetrate=44100*0.8', 'aresample=44100'],
};

export default class {
  public voiceConnection: VoiceConnection | null = null;
  public status = STATUS.PAUSED;
  public guildId: string;
  public loopCurrentSong = false;
  public loopCurrentQueue = false;
  // Tracks the last Spotify playlist URL and how many songs were loaded
  // so "Load More from Spotify" can fetch the next batch at the right offset.
  public spotifyPlaylistContext: {url: string; loadedCount: number} | null = null;
  private currentChannel: VoiceChannel | undefined;
  private queue: QueuedSong[] = [];
  private queuePosition = 0;
  // Songs waiting to be moved into the active queue as it empties.
  // Stored as plain SongMetadata (no addedInChannelId yet).
  private pendingSongs: Array<{song: SongMetadata; channelId: string; requestedBy: string}> = [];
  private audioPlayer: AudioPlayer | null = null;
  private audioResource: AudioResource | null = null;
  private volume?: number;
  private defaultVolume: number = DEFAULT_VOLUME;
  private speed = 1;
  private effect: AudioEffect = 'none';
  private eq = {bass: 0, mid: 0, treble: 0};
  private crossfade = 0;
  private consecutivePlayErrors = 0;
  private thumbnailFetchInProgress = false;
  private nowPlaying: QueuedSong | null = null;
  private playPositionInterval: NodeJS.Timeout | undefined;
  private lastSongURL = '';

  private positionInSeconds = 0;
  private readonly fileCache: FileCacheProvider;
  private disconnectTimer: NodeJS.Timeout | null = null;
  private emptyChannelTimer: NodeJS.Timeout | null = null;

  private readonly channelToSpeakingUsers: Map<string, Set<string>> = new Map();
  private hasRegisteredVoiceActivityListener = false;

  constructor(fileCache: FileCacheProvider, guildId: string) {
    this.fileCache = fileCache;
    this.guildId = guildId;
  }

  async connect(channel: VoiceChannel): Promise<void> {
    if (this.voiceConnection) {
      this.disconnect();
    }

    // Always get freshest default volume setting value
    const settings = await getGuildSettings(this.guildId);
    const {defaultVolume = DEFAULT_VOLUME} = settings;
    this.defaultVolume = defaultVolume;

    const voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
    });

    this.voiceConnection = voiceConnection;
    this.currentChannel = channel;
    this.hasRegisteredVoiceActivityListener = false;

    const guildSettings = await getGuildSettings(this.guildId);
    const stateTransitions = [voiceConnection.state.status];
    voiceConnection.on('stateChange', (oldState, newState) => {
      stateTransitions.push(newState.status);
      if (stateTransitions.length > 10) {
        stateTransitions.shift();
      }

      debug(`Voice connection state changed: ${oldState.status} -> ${newState.status}`);

      if (newState.status === VoiceConnectionStatus.Ready && !this.hasRegisteredVoiceActivityListener) {
        this.registerVoiceActivityListener(guildSettings);
        this.hasRegisteredVoiceActivityListener = true;
      }
    });

    voiceConnection.on(VoiceConnectionStatus.Disconnected, this.onVoiceConnectionDisconnect.bind(this));

    try {
      await this.waitForVoiceConnectionReady(voiceConnection);
    } catch {
      const {status} = voiceConnection.state;
      voiceConnection.destroy();
      this.voiceConnection = null;
      throw new Error(`Failed to connect to the voice channel (last state: ${status}, rejoin attempts: ${voiceConnection.rejoinAttempts}, recent states: ${stateTransitions.join(' -> ')}).`);
    }
  }

  disconnect(): void {
    if (this.voiceConnection) {
      if (this.status === STATUS.PLAYING) {
        this.pause();
      }

      this.loopCurrentSong = false;
      this.voiceConnection.destroy();
      this.audioPlayer?.stop(true);

      this.voiceConnection = null;
      this.audioPlayer = null;
      this.audioResource = null;
      this.currentChannel = undefined;
      this.channelToSpeakingUsers.clear();
      this.hasRegisteredVoiceActivityListener = false;
    }
  }

  async seek(positionSeconds: number): Promise<void> {
    this.status = STATUS.PAUSED;

    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('No song currently playing');
    }

    if (positionSeconds > currentSong.length) {
      throw new Error('Seek position is outside the range of the song.');
    }

    let realPositionSeconds = positionSeconds;
    let to: number | undefined;
    if (currentSong.offset !== undefined) {
      realPositionSeconds += currentSong.offset;
      to = currentSong.length + currentSong.offset;
    }

    const stream = await this.getStream(currentSong, {seek: realPositionSeconds, to});
    this.audioPlayer = createAudioPlayer({
      behaviors: {
        // Needs to be somewhat high for livestreams
        maxMissedFrames: 50,
      },
    });
    voiceConnection.subscribe(this.audioPlayer);
    this.playAudioPlayerResource(this.createAudioStream(stream));
    this.attachListeners();
    this.startTrackingPosition(positionSeconds);

    this.status = STATUS.PLAYING;
  }

  async forwardSeek(positionSeconds: number): Promise<void> {
    return this.seek(this.positionInSeconds + positionSeconds);
  }

  getPosition(): number {
    return this.positionInSeconds;
  }

  async play(): Promise<void> {
    const voiceConnection = await this.ensureVoiceConnectionReady();

    const currentSong = this.getCurrent();

    if (!currentSong) {
      throw new Error('Queue empty.');
    }

    // Cancel any pending idle disconnection
    if (this.disconnectTimer) {
      clearInterval(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    // Resume from paused state
    if (this.status === STATUS.PAUSED && currentSong.url === this.nowPlaying?.url) {
      if (this.audioPlayer) {
        this.audioPlayer.unpause();
        this.status = STATUS.PLAYING;
        this.startTrackingPosition();
        return;
      }

      // Was disconnected, need to recreate stream
      if (!currentSong.isLive) {
        return this.seek(this.getPosition());
      }
    }

    try {
      let positionSeconds: number | undefined;
      let to: number | undefined;
      if (currentSong.offset !== undefined) {
        positionSeconds = currentSong.offset;
        to = currentSong.length + currentSong.offset;
      }

      const stream = await this.getStream(currentSong, {seek: positionSeconds, to});
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          // Needs to be somewhat high for livestreams
          maxMissedFrames: 50,
        },
      });
      voiceConnection.subscribe(this.audioPlayer);
      this.playAudioPlayerResource(this.createAudioStream(stream));

      this.attachListeners();

      this.status = STATUS.PLAYING;
      this.nowPlaying = currentSong;

      if (currentSong.url === this.lastSongURL) {
        this.startTrackingPosition();
      } else {
        // Reset position counter
        this.startTrackingPosition(0);
        this.lastSongURL = currentSong.url;
      }

      this.consecutivePlayErrors = 0;
    } catch (error: unknown) {
      this.consecutivePlayErrors++;

      // Stop the cascade after 3 consecutive failures to prevent the bot
      // from rapidly skipping through the entire queue on e.g. a yt-dlp outage.
      if (this.consecutivePlayErrors >= 3) {
        this.consecutivePlayErrors = 0;
        this.status = STATUS.IDLE;
        return;
      }

      await this.forward(1);

      if ((error as {statusCode: number}).statusCode === 410 && currentSong) {
        const channelId = currentSong.addedInChannelId;

        if (channelId) {
          debug(`${currentSong.title} is unavailable`);
          return;
        }
      }

      throw error;
    }
  }

  pause(): void {
    if (this.status !== STATUS.PLAYING) {
      throw new Error('Not currently playing.');
    }

    this.status = STATUS.PAUSED;

    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    this.stopTrackingPosition();
  }

  async forward(skip: number): Promise<void> {
    this.manualForward(skip);

    try {
      if (this.getCurrent() && this.status !== STATUS.PAUSED) {
        await this.play();
      } else {
        this.status = STATUS.IDLE;
        this.audioPlayer?.stop(true);

        const settings = await getGuildSettings(this.guildId);

        const {secondsToWaitAfterQueueEmpties} = settings;
        if (secondsToWaitAfterQueueEmpties !== 0) {
          this.disconnectTimer = setTimeout(() => {
            // Make sure we are not accidentally playing
            // when disconnecting
            if (this.status === STATUS.IDLE) {
              this.disconnect();
            }
          }, secondsToWaitAfterQueueEmpties * 1000);
        }
      }
    } catch (error: unknown) {
      this.queuePosition--;
      throw error;
    }
  }

  registerVoiceActivityListener(guildSettings: Setting) {
    const {turnDownVolumeWhenPeopleSpeak, turnDownVolumeWhenPeopleSpeakTarget} = guildSettings;
    if (!turnDownVolumeWhenPeopleSpeak || !this.voiceConnection) {
      return;
    }

    this.voiceConnection.receiver.speaking.on('start', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel?.id;

      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.add(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });

    this.voiceConnection.receiver.speaking.on('end', (userId: string) => {
      if (!this.currentChannel) {
        return;
      }

      const member = this.currentChannel.members.get(userId);
      const channelId = this.currentChannel.id;
      if (member) {
        if (!this.channelToSpeakingUsers.has(channelId)) {
          this.channelToSpeakingUsers.set(channelId, new Set());
        }

        this.channelToSpeakingUsers.get(channelId)?.delete(member.id);
      }

      this.suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget);
    });
  }

  suppressVoiceWhenPeopleAreSpeaking(turnDownVolumeWhenPeopleSpeakTarget: number): void {
    if (!this.currentChannel) {
      return;
    }

    const speakingUsers = this.channelToSpeakingUsers.get(this.currentChannel.id);
    if (speakingUsers && speakingUsers.size > 0) {
      this.setVolume(turnDownVolumeWhenPeopleSpeakTarget);
    } else {
      this.setVolume(this.defaultVolume);
    }
  }

  canGoForward(skip: number) {
    return (this.queuePosition + skip - 1) < this.queue.length;
  }

  manualForward(skip: number): void {
    if (this.canGoForward(skip)) {
      this.queuePosition += skip;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();
    } else {
      throw new Error('No songs in queue to forward to.');
    }
  }

  canGoBack() {
    return this.queuePosition - 1 >= 0;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) {
      this.queuePosition--;
      this.positionInSeconds = 0;
      this.stopTrackingPosition();

      if (this.status !== STATUS.PAUSED) {
        await this.play();
      }
    } else {
      throw new Error('No songs in queue to go back to.');
    }
  }

  getCurrent(): QueuedSong | null {
    if (this.queue[this.queuePosition]) {
      return this.queue[this.queuePosition];
    }

    return null;
  }

  /**
   * Returns queue, not including the current song.
   * @returns {QueuedSong[]}
   */
  getQueue(): QueuedSong[] {
    return this.queue.slice(this.queuePosition + 1);
  }

  add(song: QueuedSong, {immediate = false} = {}): void {
    if (song.playlist || !immediate) {
      // Add to end of queue
      this.queue.push(song);
    } else {
      // Add as the next song to be played
      const insertAt = this.queuePosition + 1;
      this.queue = [...this.queue.slice(0, insertAt), song, ...this.queue.slice(insertAt)];
    }
  }

  shuffle(): void {
    // Shuffle the active queue AND pending together so the full set is randomised
    const upcoming = this.queue.slice(this.queuePosition + 1);
    const allUpcoming = [
      ...upcoming.map(s => ({song: s as SongMetadata, channelId: s.addedInChannelId, requestedBy: s.requestedBy})),
      ...this.pendingSongs,
    ];
    const shuffled = shuffle(allUpcoming);

    // First ACTIVE_SIZE go back into the live queue, rest stay pending
    const ACTIVE_SIZE = 100;
    const newActive: QueuedSong[] = shuffled.slice(0, ACTIVE_SIZE).map(p => ({
      ...p.song,
      addedInChannelId: p.channelId,
      requestedBy: p.requestedBy,
    }));
    this.pendingSongs = shuffled.slice(ACTIVE_SIZE);
    this.queue = [...this.queue.slice(0, this.queuePosition + 1), ...newActive];
  }

  setPendingSongs(songs: Array<{song: SongMetadata; channelId: string; requestedBy: string}>): void {
    this.pendingSongs = songs;
  }

  getPendingCount(): number {
    return this.pendingSongs.length;
  }

  getPendingPreview(n = 10): SongMetadata[] {
    return this.pendingSongs.slice(0, n).map(p => p.song);
  }

  flushPending(count = 100): void {
    this.refillFromPending(count);
  }

  clear(): void {
    const newQueue = [];

    // Don't clear curently playing song
    const current = this.getCurrent();

    if (current) {
      newQueue.push(current);
    }

    this.queuePosition = 0;
    this.queue = newQueue;
  }

  removeFromQueue(index: number, amount = 1): void {
    this.queue.splice(this.queuePosition + index, amount);
  }

  // Replace a queued song's search query with an alternative version search.
  // index is 1-based (same as the API convention for queue positions).
  // suffix is appended to "title artist", e.g. "radio edit" or "lyric video".
  replaceWithVariant(index: number, suffix: string): void {
    const song = this.queue[this.queuePosition + index];
    if (!song) {
      return;
    }

    // Build new search from title + artist — handles both ytsearch and resolved IDs
    song.url = `ytsearch1:${song.title} ${song.artist} ${suffix}`;
    song.thumbnailUrl = null; // Resolved when the song plays
  }

  shuffleQueue(): void {
    const upcoming = this.queue.splice(this.queuePosition + 1);
    this.queue.push(...shuffle(upcoming));
  }

  removeCurrent(): void {
    this.queue = [...this.queue.slice(0, this.queuePosition), ...this.queue.slice(this.queuePosition + 1)];
  }

  queueSize(): number {
    return this.getQueue().length;
  }

  isQueueEmpty(): boolean {
    return this.queueSize() === 0;
  }

  stop(): void {
    this.disconnect();
    this.queuePosition = 0;
    this.queue = [];
  }

  /**
   * Clears the entire queue and stops playback, but keeps the bot connected
   * to the voice channel. The bot will disconnect after the configured idle
   * timeout (secondsToWaitAfterQueueEmpties).
   */
  async clearQueue(): Promise<void> {
    this.audioPlayer?.stop(true);
    this.status = STATUS.IDLE;
    this.nowPlaying = null;
    this.positionInSeconds = 0;
    this.queuePosition = 0;
    this.queue = [];
    this.stopTrackingPosition();

    // Reset any pending idle disconnect timer and start a fresh one
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    const settings = await getGuildSettings(this.guildId);
    const {secondsToWaitAfterQueueEmpties} = settings;
    if (secondsToWaitAfterQueueEmpties !== 0) {
      this.disconnectTimer = setTimeout(() => {
        if (this.status === STATUS.IDLE) {
          this.disconnect();
        }
      }, secondsToWaitAfterQueueEmpties * 1000);
    }
  }

  scheduleEmptyChannelDisconnect(seconds: number): void {
    if (this.emptyChannelTimer) {
      return;
    }

    this.emptyChannelTimer = setTimeout(() => {
      this.emptyChannelTimer = null;
      if (this.voiceConnection) {
        this.disconnect();
      }
    }, seconds * 1000);
  }

  cancelEmptyChannelDisconnect(): void {
    if (this.emptyChannelTimer) {
      clearTimeout(this.emptyChannelTimer);
      this.emptyChannelTimer = null;
    }
  }

  move(from: number, to: number): QueuedSong {
    if (from > this.queueSize() || to > this.queueSize()) {
      throw new Error('Move index is outside the range of the queue.');
    }

    this.queue.splice(this.queuePosition + to, 0, this.queue.splice(this.queuePosition + from, 1)[0]);

    return this.queue[this.queuePosition + to];
  }

  setVolume(level: number): void {
    // Level should be a number between 0 and 100 = 0% => 100%
    this.volume = level;
    this.setAudioPlayerVolume(level);
  }

  getVolume(): number {
    // Only use default volume if player volume is not already set (in the event of a reconnect we shouldn't reset)
    return this.volume ?? this.defaultVolume;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.5, Math.min(2, speed));
  }

  getSpeed(): number {
    return this.speed;
  }

  setEffect(effect: AudioEffect): void {
    this.effect = effect;
  }

  getEffect(): AudioEffect {
    return this.effect;
  }

  setEq(bass: number, mid: number, treble: number): void {
    this.eq = {
      bass: Math.max(-12, Math.min(12, bass)),
      mid: Math.max(-12, Math.min(12, mid)),
      treble: Math.max(-12, Math.min(12, treble)),
    };
  }

  getEq(): {bass: number; mid: number; treble: number} {
    return {...this.eq};
  }

  setCrossfade(seconds: number): void {
    this.crossfade = Math.max(0, Math.min(8, seconds));
  }

  getCrossfade(): number {
    return this.crossfade;
  }

  // Resolve album-art thumbnails for queued and pending songs using the Deezer
  // public search API (no auth required).  Queue items are live references —
  // thumbnailUrl mutations appear in the status API on the next 2-second poll.
  prefetchThumbnails(): void {
    // Skip if a fetch is already running — prevents parallel Deezer floods
    // when the frontend calls refresh-thumbnails every few seconds.
    if (this.thumbnailFetchInProgress) {
      return;
    }

    const noThumb = (s: SongMetadata) => !s.thumbnailUrl;

    const targets: SongMetadata[] = [
      ...this.queue.filter(noThumb),
      ...this.pendingSongs.map(p => p.song).filter(noThumb),
    ];

    if (targets.length === 0) {
      return;
    }

    const deezerLookup = async (song: SongMetadata): Promise<void> =>
      new Promise(resolve => {
        if (song.thumbnailUrl) {
          resolve();
          return;
        }

        const q = encodeURIComponent(`${song.title} ${song.artist}`);
        const req = https.get(
          `https://api.deezer.com/search?q=${q}&limit=1`,
          {headers: {'User-Agent': 'Mozilla/5.0'}},
          (res: {on(e: string, cb: (...a: unknown[]) => void): void}) => {
            let raw = '';
            res.on('data', (chunk: unknown) => {
              raw += String(chunk);
            });
            res.on('end', () => {
              try {
                const body = JSON.parse(raw) as {data?: Array<{album?: {cover_xl?: string; cover_medium?: string}}>};
                const cover = body.data?.[0]?.album?.cover_xl ?? body.data?.[0]?.album?.cover_medium ?? null;
                if (cover && !song.thumbnailUrl) {
                  song.thumbnailUrl = cover;
                }
              } catch { /* malformed JSON — leave thumbnail null */ }

              resolve();
            });
            res.on('error', () => {
              resolve();
            });
          },
        );
        req.on('error', () => {
          resolve();
        });
        req.setTimeout(5000, () => {
          req.destroy();
          resolve();
        });
      });

    // Deezer allows 50 req / 5 s — fire 50 at a time with a 5 s gap.
    this.thumbnailFetchInProgress = true;
    void (async () => {
      try {
        const BATCH = 50;
        for (let i = 0; i < targets.length; i += BATCH) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.allSettled(targets.slice(i, i + BATCH).map(deezerLookup));
          if (i + BATCH < targets.length) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>(resolve => {
              setTimeout(resolve, 5000);
            });
          }
        }
      } finally {
        this.thumbnailFetchInProgress = false;
      }
    })();
  }

  private refillFromPending(count = 20): void {
    const toAdd = this.pendingSongs.splice(0, count);
    for (const p of toAdd) {
      this.queue.push({...p.song, addedInChannelId: p.channelId, requestedBy: p.requestedBy} as QueuedSong);
    }

    if (toAdd.length > 0) {
      this.prefetchThumbnails();
    }
  }

  private getHashForCache(url: string): string {
    return hasha(url);
  }

  private async getStream(song: QueuedSong, options: {seek?: number; to?: number} = {}): Promise<Readable> {
    if (this.status === STATUS.PLAYING) {
      // Remove listeners BEFORE stopping so the Idle event on the old player
      // does not fire onAudioPlayerIdle and trigger an unintended extra forward().
      this.audioPlayer?.removeAllListeners();
      this.audioPlayer?.stop();
    } else if (this.status === STATUS.PAUSED) {
      this.audioPlayer?.removeAllListeners();
      this.audioPlayer?.stop(true);
    }

    if (song.source === MediaSource.HLS) {
      return this.createReadStream({input: song.url, cacheKey: song.url});
    }

    let ffmpegInput: string | null;
    const ffmpegInputOptions: string[] = [];
    let shouldCacheVideo = false;

    ffmpegInput = await this.fileCache.getPathFor(this.getHashForCache(song.url));

    if (!ffmpegInput) {
      // Resolve ytsearch1: queries to a real YouTube video ID first so errors surface properly
      if (song.url.startsWith('ytsearch1:')) {
        const query = song.url.slice('ytsearch1:'.length);
        const result = await searchWithYtDlp(query);
        if (!result?.id) {
          throw new Error(`Could not find a YouTube match for: ${song.title}`);
        }

        song.url = result.id;
        // YouTube thumbnails disabled — Deezer provides higher-quality
        // album art via prefetchThumbnails and doesn't show video screenshots.
      }

      const MAX_CACHE_LENGTH_SECONDS = 30 * 60; // 30 minutes

      if (!options.seek) {
        // Pipe yt-dlp stdout directly to ffmpeg so yt-dlp handles DASH segments internally
        const {stream: ytdlpStream, kill: ytdlpKill} = createYtDlpAudioStream(song.url);
        shouldCacheVideo = !song.isLive && song.length < MAX_CACHE_LENGTH_SECONDS;
        debug(shouldCacheVideo ? 'Caching video (piped)' : 'Streaming via yt-dlp pipe');
        return this.createReadStream({
          input: ytdlpStream,
          ytdlpKill,
          cacheKey: song.url,
          cache: shouldCacheVideo,
          songLength: song.length,
        });
      }

      // Seek: need a URL with -ss; piped stream doesn't support seeking.
      // ytsearch1: URLs can't be resolved to a seekable CDN URL — pipe from start instead.
      if (song.url.startsWith('ytsearch')) {
        const {stream: ytdlpStream, kill: ytdlpKill} = createYtDlpAudioStream(song.url);
        return this.createReadStream({input: ytdlpStream, ytdlpKill, cacheKey: song.url, cache: false});
      }

      const mediaSource = await getYouTubeMediaSource(song.url);
      ffmpegInput = mediaSource.url;
      ffmpegInputOptions.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
      const headerOptions = this.buildFfmpegHeaderOptions(mediaSource.headers);
      ffmpegInputOptions.push(...headerOptions);
    }

    if (options.seek) {
      ffmpegInputOptions.push('-ss', options.seek.toString());
    }

    if (options.to) {
      ffmpegInputOptions.push('-to', options.to.toString());
    }

    return this.createReadStream({
      input: ffmpegInput,
      cacheKey: song.url,
      ffmpegInputOptions,
      cache: shouldCacheVideo,
      songLength: song.length,
    });
  }

  private startTrackingPosition(initalPosition?: number): void {
    if (initalPosition !== undefined) {
      this.positionInSeconds = initalPosition;
    }

    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }

    this.playPositionInterval = setInterval(() => {
      this.positionInSeconds++;
    }, 1000);
  }

  private stopTrackingPosition(): void {
    if (this.playPositionInterval) {
      clearInterval(this.playPositionInterval);
    }
  }

  private attachListeners(): void {
    if (!this.voiceConnection) {
      return;
    }

    if (!this.audioPlayer) {
      return;
    }

    if (this.audioPlayer.listeners('stateChange').length === 0) {
      this.audioPlayer.on(AudioPlayerStatus.Idle, this.onAudioPlayerIdle.bind(this));
    }
  }

  private async onVoiceConnectionDisconnect(): Promise<void> {
    if (!this.voiceConnection || this.voiceConnection.state.status !== VoiceConnectionStatus.Disconnected) {
      return;
    }

    const disconnectedState = this.voiceConnection.state;
    if (disconnectedState.reason === VoiceConnectionDisconnectReason.WebSocketClose && disconnectedState.closeCode === 4014) {
      try {
        await Promise.race([
          entersState(this.voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
          entersState(this.voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        ]);
        return;
      } catch {
        this.disconnect();
        return;
      }
    }

    if (this.voiceConnection.rejoinAttempts < 5) {
      await sleep((this.voiceConnection.rejoinAttempts + 1) * 5_000);

      if (this.voiceConnection && this.voiceConnection.state.status === VoiceConnectionStatus.Disconnected) {
        if (this.voiceConnection.rejoin()) {
          return;
        }
      }
    }

    this.disconnect();
  }

  private async ensureVoiceConnectionReady(): Promise<VoiceConnection> {
    if (this.voiceConnection === null) {
      throw new Error('Not connected to a voice channel.');
    }

    await this.waitForVoiceConnectionReady(this.voiceConnection);

    return this.voiceConnection;
  }

  private async waitForVoiceConnectionReady(voiceConnection: VoiceConnection): Promise<void> {
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 60_000);
  }

  private async onAudioPlayerIdle(_oldState: AudioPlayerState, newState: AudioPlayerState): Promise<void> {
    // Automatically advance queued song at end
    if (this.loopCurrentSong && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      await this.seek(0);
      return;
    }

    // Automatically re-add current song to queue
    if (this.loopCurrentQueue && newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      const currentSong = this.getCurrent();

      if (currentSong) {
        this.add(currentSong);
      } else {
        throw new Error('No song currently playing.');
      }
    }

    if (newState.status === AudioPlayerStatus.Idle && this.status === STATUS.PLAYING) {
      // Top up from pending when fewer than 20 songs remain
      const remaining = this.queue.length - this.queuePosition - 1;
      if (remaining < 20 && this.pendingSongs.length > 0) {
        this.refillFromPending(20);
      }

      await this.forward(1);
      // Auto announce the next song if configured to
      const settings = await getGuildSettings(this.guildId);
      const {autoAnnounceNextSong} = settings;
      if (autoAnnounceNextSong && this.currentChannel) {
        await this.currentChannel.send({
          embeds: this.getCurrent() ? [buildPlayingMessageEmbed(this)] : [],
        });
      }
    }
  }

  private buildFfmpegHeaderOptions(headers: Record<string, string>) {
    const headerLines = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    if (!headerLines) {
      return [];
    }

    return ['-headers', `${headerLines}\r\n`];
  }

  private async createReadStream(options: {input: string | Readable; ytdlpKill?: () => void; cacheKey: string; ffmpegInputOptions?: string[]; cache?: boolean; songLength?: number}): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const capacitor = new WriteStream();

      if (options?.cache) {
        const cacheStream = this.fileCache.createWriteStream(this.getHashForCache(options.cacheKey));
        capacitor.createReadStream().pipe(cacheStream);
      }

      const returnedStream = capacitor.createReadStream();
      let hasReturnedStreamClosed = false;

      const inputOptions = typeof options.input === 'string'
        ? (options?.ffmpegInputOptions ?? ['-re'])
        : [];

      const ffmpegCmd = ffmpeg(options.input)
        .inputOptions(inputOptions)
        .noVideo()
        .audioCodec('libopus')
        .outputFormat('webm');

      const activeFilters: string[] = [];
      if (this.speed !== 1) {
        activeFilters.push(`atempo=${this.speed}`);
      }

      activeFilters.push(...AUDIO_EFFECT_FILTERS[this.effect]);

      if (this.eq.bass !== 0) {
        activeFilters.push(`equalizer=f=80:t=q:w=1.0:g=${this.eq.bass}`);
      }

      if (this.eq.mid !== 0) {
        activeFilters.push(`equalizer=f=1000:t=q:w=1.0:g=${this.eq.mid}`);
      }

      if (this.eq.treble !== 0) {
        activeFilters.push(`equalizer=f=8000:t=q:w=1.0:g=${this.eq.treble}`);
      }

      // Crossfade: fade-in at start, fade-out near the end of the track.
      // Applied last so it wraps all other processing.
      if (this.crossfade > 0) {
        activeFilters.push(`afade=t=in:st=0:d=${this.crossfade}`);
        const len = options.songLength ?? 0;
        if (len > this.crossfade * 2) {
          activeFilters.push(`afade=t=out:st=${len - this.crossfade}:d=${this.crossfade}`);
        }
      }

      if (activeFilters.length > 0) {
        ffmpegCmd.audioFilters(activeFilters);
      }

      const stream = ffmpegCmd
        .on('error', error => {
          if (!hasReturnedStreamClosed) {
            reject(error);
          }
        })
        .on('start', command => {
          debug(`Spawned ffmpeg with ${command}`);
        });

      stream.pipe(capacitor);

      returnedStream.on('close', () => {
        if (!options.cache) {
          stream.kill('SIGKILL');
          options.ytdlpKill?.();
        }

        hasReturnedStreamClosed = true;
      });

      resolve(returnedStream);
    });
  }

  private createAudioStream(stream: Readable) {
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });
  }

  private playAudioPlayerResource(resource: AudioResource) {
    if (this.audioPlayer !== null) {
      this.audioResource = resource;
      this.setAudioPlayerVolume();
      this.audioPlayer.play(this.audioResource);
    }
  }

  private setAudioPlayerVolume(level?: number) {
    // Audio resource expects a float between 0 and 1 to represent level percentage
    this.audioResource?.volume?.setVolume((level ?? this.getVolume()) / 100);
  }
}
