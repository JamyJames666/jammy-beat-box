// ── Types ────────────────────────────────────────────────────────────────────

export interface Guild   { id: string; name: string }
export interface Channel { id: string; name: string }

export interface TrackInfo {
  title:        string
  artist:       string
  length:       number
  thumbnailUrl: string | null
  url:          string
  source?:      'youtube' | 'spotify'
}

export interface PlayerStatus {
  status:     'PLAYING' | 'PAUSED' | 'IDLE'
  nowPlaying: TrackInfo | null
  position:   number
  queue:      TrackInfo[]
  volume:     number
}

// ── Client ───────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function req<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string }
    throw new ApiError(res.status, data.error ?? res.statusText)
  }

  return res.json() as Promise<T>
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function login(password: string): Promise<string> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Login failed' })) as { error?: string }
    throw new Error(data.error ?? 'Login failed')
  }
  const { token } = await res.json() as { token: string }
  return token
}

export const getGuilds   = (t: string) => req<Guild[]>  ('GET', '/api/guilds', t)
export const getChannels = (t: string, guildId: string) =>
  req<Channel[]>('GET', `/api/guilds/${guildId}/channels`, t)
export const getStatus   = (t: string, guildId: string) =>
  req<PlayerStatus>('GET', `/api/guilds/${guildId}/status`, t)

export const play    = (t: string, guildId: string, query: string, channelId?: string) =>
  req<{ ok: boolean; added: number; first: string }>(
    'POST', `/api/guilds/${guildId}/play`, t, { query, channelId },
  )
export const pause   = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/pause`,  t)
export const resume  = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/resume`, t)
export const skip    = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/skip`,   t)
export const stop    = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/stop`,   t)
export const shuffle    = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/queue/shuffle`, t)
export const clearQueue = (t: string, guildId: string) => req('POST', `/api/guilds/${guildId}/queue/clear`,   t)
export const move       = (t: string, guildId: string, from: number, to: number) =>
  req('POST', `/api/guilds/${guildId}/queue/move`,   t, { from, to })
export const remove     = (t: string, guildId: string, index: number) =>
  req('POST', `/api/guilds/${guildId}/queue/remove`, t, { index })
export const setVolume = (t: string, guildId: string, level: number) =>
  req('POST', `/api/guilds/${guildId}/volume`, t, { level })
