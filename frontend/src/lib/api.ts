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

export type AudioEffect = 'none' | 'bass' | 'treble' | 'reverb' | '8d' | 'nightcore' | 'vaporwave'

export interface PlayerStatus {
  status:     'PLAYING' | 'PAUSED' | 'IDLE'
  nowPlaying: TrackInfo | null
  position:   number
  queue:      TrackInfo[]
  volume:     number
  speed:      number
  effect:     AudioEffect
  eq:         { bass: number; mid: number; treble: number }
  crossfade:  number
  loopSong:      boolean
  loopQueue:     boolean
  pendingCount:  number
  pendingPreview: Array<{ title: string; artist: string }>
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

export const getGuilds      = (t: string) => req<Guild[]>('GET', '/api/guilds', t)
export const getChannels    = (t: string, guildId: string) =>
  req<Channel[]>('GET', `/api/guilds/${guildId}/channels`, t)
export const getTextChannels = (t: string, guildId: string) =>
  req<Channel[]>('GET', `/api/guilds/${guildId}/text-channels`, t)
export const getStatus      = (t: string, guildId: string) =>
  req<PlayerStatus>('GET', `/api/guilds/${guildId}/status`, t)

export const getAnnouncementChannel = (t: string, guildId: string) =>
  req<{announcementChannelId: string | null}>('GET', `/api/guilds/${guildId}/settings/announcement`, t)
export const setAnnouncementChannel = (t: string, guildId: string, channelId: string | null) =>
  req<{ok: boolean}>('POST', `/api/guilds/${guildId}/settings/announcement`, t, {channelId})

export const play    = (t: string, guildId: string, query: string, channelId?: string) =>
  req<{ ok: boolean; added: number; queued: number; pending: number; first: string }>(
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
export const setVariant = (t: string, guildId: string, index: number, suffix: string) =>
  req('POST', `/api/guilds/${guildId}/queue/variant`, t, { index, suffix })
export const setVolume = (t: string, guildId: string, level: number) =>
  req('POST', `/api/guilds/${guildId}/volume`, t, { level })
export const seek     = (t: string, guildId: string, position: number) =>
  req('POST', `/api/guilds/${guildId}/seek`, t, { position })
export const setSpeed  = (t: string, guildId: string, speed: number) =>
  req('POST', `/api/guilds/${guildId}/speed`, t, { speed })
export const setEffect = (t: string, guildId: string, effect: AudioEffect) =>
  req('POST', `/api/guilds/${guildId}/effect`, t, { effect })
export const setEq = (t: string, guildId: string, bass: number, mid: number, treble: number) =>
  req('POST', `/api/guilds/${guildId}/eq`, t, { bass, mid, treble })
export const setCrossfade = (t: string, guildId: string, seconds: number) =>
  req('POST', `/api/guilds/${guildId}/crossfade`, t, { seconds })
export const toggleLoopSong  = (t: string, guildId: string) =>
  req('POST', `/api/guilds/${guildId}/loop-song`,  t)
export const toggleLoopQueue = (t: string, guildId: string) =>
  req('POST', `/api/guilds/${guildId}/loop-queue`, t)
export const flushPending         = (t: string, guildId: string, count = 100) =>
  req<{ok: boolean}>('POST', `/api/guilds/${guildId}/queue/flush-pending`, t, {count})
export const refreshThumbnails    = (t: string, guildId: string) =>
  req<{ok: boolean; missing: number}>('POST', `/api/guilds/${guildId}/queue/refresh-thumbnails`, t)
