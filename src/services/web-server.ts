import {inject, injectable} from 'inversify';
import {createServer} from 'http';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import {fileURLToPath} from 'url';
import {Client} from 'discord.js';
import {TYPES} from '../types.js';
import Config from './config.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from './player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@injectable()
export default class WebServer {
  private readonly app = express();
  private readonly password: string;
  private readonly port: number;
  private readonly playerManager: PlayerManager;
  private readonly client: Client;

  constructor(
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Client) client: Client,
  ) {
    this.password = config.WEB_PASSWORD;
    this.port = config.WEB_PORT;
    this.playerManager = playerManager;
    this.client = client;
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
          }
          : null,
        position: player.getPosition(),
        queue: player.getQueue().map(s => ({title: s.title, artist: s.artist, length: s.length})),
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
