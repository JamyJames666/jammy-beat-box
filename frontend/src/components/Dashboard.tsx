import { useState, useEffect, useCallback, useRef } from 'react'
import { Music2, ChevronDown, Sun, Moon } from 'lucide-react'
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
      <header className="sticky top-0 z-30 backdrop-blur-md px-6 py-3.5"
        style={{ background: 'rgba(13,13,13,0.9)', borderBottom: '1px solid #1f1f1f' }}>
        <div className="max-w-[1800px] mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-8 h-8 rounded-xl bg-app-accent/20 flex items-center justify-center">
              <Music2 size={16} className="text-app-accent" />
            </div>
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
        <div className="max-w-[1800px] mx-auto flex gap-0" style={{ height: 'calc(100vh - 57px)' }}>

          {/* Left column: Now Playing */}
          <div className="flex-shrink-0 relative overflow-hidden flex flex-col"
            style={{ width: 440 }}>
            <div className="relative z-10 flex flex-col gap-4 p-6 h-full">
              <NowPlaying
                status={status}
                token={token}
                guildId={guildId}
                onRefresh={poll}
              />
              <div className="mt-auto flex flex-col gap-3">
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
          <div className="flex-shrink-0" style={{ width: 1, background: '#1f1f1f' }} />

          {/* Right column: Queue */}
          <div className="flex-1 overflow-hidden flex flex-col p-6">
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
