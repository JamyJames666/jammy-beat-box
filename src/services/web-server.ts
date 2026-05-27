import {inject, injectable} from 'inversify';
import {createServer} from 'http';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import {fileURLToPath} from 'url';
import {Client, VoiceChannel, ChannelType, TextChannel} from 'discord.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import PlayerManager from '../managers/player.js';
import GetSongs from './get-songs.js';
import {STATUS} from './player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Detect whether a queued song originated from Spotify or YouTube.
 * Spotify songs use Spotify CDN thumbnails (i.scdn.co) or have a Spotify
 * API URL as their playlist source. Everything else is treated as YouTube.
 */
const songSourceLabel = (song: {thumbnailUrl: string | null; playlist: {source: string} | null}): 'spotify' | 'youtube' => {
  if (song.thumbnailUrl?.includes('scdn.co')) return 'spotify';
  if (song.playlist?.source && (song.playlist.source.includes('spotify') || song.playlist.source.includes('api.spotify'))) {
    return 'spotify';
  }

  return 'youtube';
};

const WEB_ADDED_MESSAGES_SINGLE = [
  '🖥️ someone snuck in from the web dashboard and queued up **{song}**',
  '🌐 remote control activated — **{song}** just dropped into the queue',
  '📲 the web overlords have spoken: **{song}** has been summoned',
  '👀 **{song}** materialised from thin air (the web dashboard did it)',
  '🕹️ a mysterious dashboard user added **{song}** to the queue',
  '🌍 beaming in from the internet: **{song}** is now in the queue',
  '🤖 the web dashboard just YOLO\'d **{song}** into the queue',
  '🎯 someone aimed their browser at the queue and fired: **{song}**',
];

const WEB_ADDED_MESSAGES_PLAYLIST = [
  '🖥️ the web dashboard just carpet-bombed the queue with **{count} songs** starting with **{first}**',
  '🌐 {count} songs incoming from the web dashboard — leading off with **{first}**',
  '📲 whoever\'s on the dashboard just queued **{count} songs** ({first} + more)',
  '🎵 web dashboard move: **{count} songs** added, starting with **{first}**',
  '🌊 a wave of **{count} songs** washed in from the web dashboard — **{first}** up first',
  '👾 web dashboard user: *adds {count} songs at once* — first up: **{first}**',
];

const pickWebMessage = (count: number, first: string): string => {
  if (count === 1) {
    const template = WEB_ADDED_MESSAGES_SINGLE[Math.floor(Math.random() * WEB_ADDED_MESSAGES_SINGLE.length)];
    return template.replace('{song}', first);
  }

  const template = WEB_ADDED_MESSAGES_PLAYLIST[Math.floor(Math.random() * WEB_ADDED_MESSAGES_PLAYLIST.length)];
  return template.replace('{count}', String(count)).replace('{first}', first);
};

/**
 * Find the best text channel in a guild to announce web-dashboard activity.
 * Prefers the guild's system channel, then falls back to the first GuildText
 * channel the bot can both view and send messages in.
 */
const findAnnouncementChannel = (client: Client, guildId: string): TextChannel | null => {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const botId = client.user?.id;

  const canSend = (ch: TextChannel) => {
    if (!botId) return true;
    const perms = ch.permissionsFor(botId);
    return perms?.has('SendMessages') && perms?.has('ViewChannel');
  };

  // Prefer system channel
  if (guild.systemChannel && canSend(guild.systemChannel)) {
    return guild.systemChannel;
  }

  // Fall back to first writable text channel
  const fallback = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText)
    .find(c => canSend(c as TextChannel));

  return (fallback as TextChannel | undefined) ?? null;
};

@injectable()
export default class WebServer {
  private readonly app = express();
  private readonly password: string;
  private readonly port: number;
  private readonly playerManager: PlayerManager;
  private readonly client: Client;
  private readonly getSongs: GetSongs;

  constructor(
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Client) client: Client,
    @inject(TYPES.Services.GetSongs) getSongs: GetSongs,
  ) {
    this.password = config.WEB_PASSWORD;
    this.port = config.WEB_PORT;
    this.playerManager = playerManager;
    this.client = client;
    this.getSongs = getSongs;
  }

  start(): void {
    if (!this.password) {
      return;
    }

    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../../static')));

    const loginAttempts = new Map<string, {count: number; resetAt: number}>();

    this.app.post('/api/login', (req: express.Request, res: express.Response) => {
      const ip = req.ip ?? 'unknown';
      const now = Date.now();
      const record = loginAttempts.get(ip);

      if (record && now < record.resetAt && record.count >= 10) {
        res.status(429).json({error: 'Too many login attempts'});
        return;
      }

      if (!record || now >= record.resetAt) {
        loginAttempts.set(ip, {count: 1, resetAt: now + 15 * 60 * 1000});
      } else {
        record.count++;
      }

      const {password} = req.body as {password?: string};
      if (password !== this.password) {
        res.status(401).json({error: 'Invalid password'});
        return;
      }

      const entry = loginAttempts.get(ip);
      if (entry) entry.count = 0;

      res.json({token: this.generateToken()});
    });

    const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!this.verifyToken(token)) {
        res.status(401).json({error: 'Unauthorized'});
        return;
      }

      next();
    };

    this.app.get('/api/guilds', auth, (_req: express.Request, res: express.Response) => {
      const guilds = this.client.guilds.cache.map(g => ({id: g.id, name: g.name}));
      res.json(guilds);
    });

    this.app.get('/api/guilds/:guildId/channels', auth, (req: express.Request, res: express.Response) => {
      const guild = this.client.guilds.cache.get(req.params.guildId);
      if (!guild) {
        res.status(404).json({error: 'Guild not found'});
        return;
      }

      const channels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildVoice)
        .map(c => ({id: c.id, name: c.name}));
      res.json(Array.from(channels.values()));
    });

    this.app.post('/api/guilds/:guildId/play', auth, async (req: express.Request, res: express.Response) => {
      const {query, channelId} = req.body as {query?: string; channelId?: string};
      if (!query) {
        res.status(400).json({error: 'query is required'});
        return;
      }

      const guild = this.client.guilds.cache.get(req.params.guildId);
      if (!guild) {
        res.status(404).json({error: 'Guild not found'});
        return;
      }

      try {
        const [songs] = await this.getSongs.getSongs(query, 100, false);
        if (songs.length === 0) {
          res.status(400).json({error: 'No songs found'});
          return;
        }

        const player = this.playerManager.get(req.params.guildId);
        const fallbackChannelId = guild.channels.cache.find(c => c.type === ChannelType.GuildVoice)?.id ?? '';
        const targetChannelId = channelId ?? fallbackChannelId;

        songs.forEach(song => {
          player.add({
            ...song,
            addedInChannelId: targetChannelId,
            requestedBy: 'web-dashboard',
          });
        });

        if (!player.voiceConnection && targetChannelId) {
          const channel = guild.channels.cache.get(targetChannelId) as VoiceChannel;
          await player.connect(channel);
          await player.play();
        } else if (player.status === STATUS.IDLE) {
          await player.play();
        }

        // Announce to Discord that the web dashboard added songs
        const announceCh = findAnnouncementChannel(this.client, req.params.guildId);
        if (announceCh) {
          const msg = pickWebMessage(songs.length, songs[0].title);
          announceCh.send(msg).catch(() => { /* best-effort */ });
        }

        res.json({ok: true, added: songs.length, first: songs[0].title});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.get('/api/guilds/:guildId/status', auth, (req: express.Request, res: express.Response) => {
      const player = this.playerManager.get(req.params.guildId);
      const current = player.getCurrent();
      res.json({
        status: STATUS[player.status],
        nowPlaying: current
          ? {
            title: current.title,
            artist: current.artist,
            length: current.length,
            thumbnailUrl: current.thumbnailUrl,
            url: current.url,
            source: songSourceLabel(current),
          }
          : null,
        position: player.getPosition(),
        queue: player.getQueue().map(s => ({
          title: s.title,
          artist: s.artist,
          length: s.length,
          thumbnailUrl: s.thumbnailUrl,
          url: s.url,
          source: songSourceLabel(s),
        })),
        volume: player.getVolume(),
      });
    });

    this.app.post('/api/guilds/:guildId/pause', auth, (req: express.Request, res: express.Response) => {
      try {
        this.playerManager.get(req.params.guildId).pause();
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/resume', auth, async (req: express.Request, res: express.Response) => {
      try {
        await this.playerManager.get(req.params.guildId).play();
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/skip', auth, async (req: express.Request, res: express.Response) => {
      try {
        await this.playerManager.get(req.params.guildId).forward(1);
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/stop', auth, (req: express.Request, res: express.Response) => {
      try {
        this.playerManager.get(req.params.guildId).stop();
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/queue/shuffle', auth, (req: express.Request, res: express.Response) => {
      try {
        this.playerManager.get(req.params.guildId).shuffleQueue();
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/queue/move', auth, (req: express.Request, res: express.Response) => {
      const {from, to} = req.body as {from?: number; to?: number};
      if (typeof from !== 'number' || typeof to !== 'number') {
        res.status(400).json({error: 'from and to are required'});
        return;
      }

      try {
        this.playerManager.get(req.params.guildId).move(from, to);
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/queue/remove', auth, (req: express.Request, res: express.Response) => {
      const {index} = req.body as {index?: number};
      if (typeof index !== 'number') {
        res.status(400).json({error: 'index is required'});
        return;
      }

      try {
        this.playerManager.get(req.params.guildId).removeFromQueue(index);
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    this.app.post('/api/guilds/:guildId/volume', auth, (req: express.Request, res: express.Response) => {
      const {level} = req.body as {level?: number};
      if (typeof level !== 'number' || level < 0 || level > 200) {
        res.status(400).json({error: 'Volume must be 0-200'});
        return;
      }

      try {
        this.playerManager.get(req.params.guildId).setVolume(level);
        res.json({ok: true});
      } catch (e: unknown) {
        res.status(400).json({error: (e as Error).message});
      }
    });

    createServer(this.app).listen(this.port, () => {
      console.log(`Web dashboard running on port ${this.port}`);
    });
  }

  private generateToken(): string {
    const timestamp = Date.now().toString();
    const sig = crypto.createHmac('sha256', this.password).update(timestamp).digest('hex');
    return Buffer.from(`${timestamp}.${sig}`).toString('base64url');
  }

  private verifyToken(token: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64url').toString();
      const dotIndex = decoded.lastIndexOf('.');
      if (dotIndex < 0) return false;

      const timestamp = decoded.slice(0, dotIndex);
      const sig = decoded.slice(dotIndex + 1);
      const expectedSig = crypto.createHmac('sha256', this.password).update(timestamp).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
        return false;
      }

      return Date.now() - parseInt(timestamp, 10) < TOKEN_MAX_AGE_MS;
    } catch {
      return false;
    }
  }
}
