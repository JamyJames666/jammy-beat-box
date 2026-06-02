import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, Sun, Moon } from 'lucide-react'
import {
  getGuilds, getChannels, getStatus,
  ApiError,
  type Guild, type Channel, type PlayerStatus,
} from '@/lib/api'
import NowPlaying from './NowPlaying'
import QueueCard from './QueueCard'
import AddToQueue from './AddToQueue'
import BotSettings from './BotSettings'
import DjDeckV3 from './DjDeckV3'
import AutoDj from './AutoDj'

interface Props {
  token: string
  onSessionExpired: () => void
  onReconnecting: (v: boolean) => void
}

// Inline SVG logo — equalizer bars
function JammyLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="8" fill="url(#logoGrad)" />
      <rect x="5"  y="16" width="3.5" height="7"  rx="1.5" fill="white" opacity="0.9" />
      <rect x="10" y="10" width="3.5" height="13" rx="1.5" fill="white" />
      <rect x="15" y="13" width="3.5" height="10" rx="1.5" fill="white" opacity="0.85" />
      <rect x="20" y="7"  width="3.5" height="16" rx="1.5" fill="white" opacity="0.7" />
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function Dashboard({ token, onSessionExpired, onReconnecting }: Props) {
  const [guilds,    setGuilds]    = useState<Guild[]>([])
  const [channels,  setChannels]  = useState<Channel[]>([])
  const [guildId,   setGuildId]   = useState<string>(() => localStorage.getItem('muse_guild') ?? '')
  const [channelId, setChannelId] = useState<string>('')
  const [status,    setStatus]    = useState<PlayerStatus | null>(null)
  const [_view] = useState<'player' | 'dj' | 'autodj'>('player')

  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('muse_theme') as 'dark' | 'light') ?? 'dark',
  )
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('muse_theme', theme)
  }, [theme])

  useEffect(() => {
    getGuilds(token)
      .then(gs => {
        setGuilds(gs)
        if (!guildId && gs.length) {
          const id = gs[0].id
          setGuildId(id)
          localStorage.setItem('muse_guild', id)
        }
      })
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) onSessionExpired()
      })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!guildId) return
    getChannels(token, guildId)
      .then(cs => {
        setChannels(cs)
        const saved = localStorage.getItem(`muse_channel_${guildId}`)
        const match = saved && cs.find(c => c.id === saved)
        const id = match ? saved : cs[0]?.id ?? ''
        setChannelId(id)
      })
      .catch(() => { /* non-fatal */ })
  }, [token, guildId])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!guildId) return
    try {
      const s = await getStatus(token, guildId)
      setStatus(s)
      onReconnecting(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired()
      } else {
        onReconnecting(true)
      }
    }
  }, [token, guildId, onSessionExpired, onReconnecting])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll])

  const handleGuildChange = (id: string) => {
    setGuildId(id)
    setStatus(null)
    localStorage.setItem('muse_guild', id)
  }

  const handleChannelChange = (id: string) => {
    setChannelId(id)
    localStorage.setItem(`muse_channel_${guildId}`, id)
  }

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md px-6 py-3"
        style={{ background: 'rgba(13,13,13,0.92)', borderBottom: '1px solid #1f1f1f' }}>
        <div className="max-w-[1800px] mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2.5 mr-auto">
            <JammyLogo />
            <span className="font-bold text-white text-base tracking-tight">Jammy Beat Box</span>
          </div>

          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-app-border"
            style={{ color: '#888' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {guilds.length > 0 && (
            <div className="relative">
              <select
                value={guildId}
                onChange={e => handleGuildChange(e.target.value)}
                className="appearance-none bg-app-panel border border-app-border rounded-xl
                           text-app-text text-sm pl-4 pr-9 py-2 cursor-pointer
                           focus:outline-none focus:border-app-accent hover:border-app-muted/50
                           transition-colors"
              >
                {guilds.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2
                                                 pointer-events-none" style={{ color: '#888' }} />
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      {_view === 'dj' ? (
        <DjDeckV3 status={status} token={token} guildId={guildId} onRefresh={poll} />
      ) : _view === 'autodj' ? (
        <AutoDj status={status} token={token} guildId={guildId} onRefresh={poll} />
      ) : (
        <div className="max-w-[1800px] mx-auto flex" style={{ height: 'calc(100vh - 53px)' }}>

          {/* Left: Now Playing */}
          <div className="flex-shrink-0 relative overflow-hidden flex flex-col" style={{ width: 520 }}>
            {/* Ambient glow */}
            <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
              style={{
                top: 40, width: 360, height: 360,
                background: 'radial-gradient(circle, rgba(210,130,50,0.28) 0%, rgba(160,80,20,0.1) 50%, transparent 70%)',
                filter: 'blur(50px)',
                borderRadius: '50%',
                zIndex: 0,
              }} />
            <div className="relative z-10 flex flex-col gap-4 p-6 h-full overflow-y-auto">
              <NowPlaying status={status} token={token} guildId={guildId} onRefresh={poll} />
              <div className="mt-auto flex flex-col gap-3 pt-4">
                <AddToQueue
                  token={token}
                  guildId={guildId}
                  channels={channels}
                  channelId={channelId}
                  onChannelChange={handleChannelChange}
                  onRefresh={poll}
                />
                <BotSettings token={token} guildId={guildId} />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="flex-shrink-0" style={{ width: 1, background: '#1a1a1a' }} />

          {/* Right: Queue */}
          <div className="flex-1 overflow-hidden p-6">
            <QueueCard
              queue={status?.queue ?? []}
              token={token}
              guildId={guildId}
              onRefresh={poll}
              pendingCount={status?.pendingCount ?? 0}
              pendingPreview={status?.pendingPreview ?? []}
            />
          </div>

        </div>
      )}
    </div>
  )
}
