import { useState, useEffect, useCallback, useRef } from 'react'
import { Music2, ChevronDown, Sliders } from 'lucide-react'
import {
  getGuilds, getChannels, getStatus,
  ApiError,
  type Guild, type Channel, type PlayerStatus,
} from '@/lib/api'
import NowPlaying from './NowPlaying'
import QueueCard from './QueueCard'
import AddToQueue from './AddToQueue'
import BotSettings from './BotSettings'
import DjDeck from './DjDeck'

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
  const [view,      setView]      = useState<'player' | 'deck'>('player')

  // ── Load guilds on mount ────────────────────────────────────────────────────
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

  // ── Load channels when guild changes ────────────────────────────────────────
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

  // ── Poll player status every 2 s ────────────────────────────────────────────
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

  // ── Guild change ─────────────────────────────────────────────────────────────
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
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-app-surface/80 backdrop-blur-md
                         border-b border-app-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-8 h-8 rounded-xl bg-app-accent/20 flex items-center justify-center">
              <Music2 size={16} className="text-app-accent" />
            </div>
            <span className="font-bold text-app-text text-base tracking-tight">Muse</span>
          </div>

          {/* View tabs */}
          <div className="flex items-center gap-1 bg-app-panel rounded-xl p-1 border border-app-border">
            <button
              onClick={() => setView('player')}
              className={view === 'player'
                ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-surface text-app-text text-xs font-medium shadow-sm'
                : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-app-muted hover:text-app-text text-xs font-medium transition-colors'}
            >
              <Music2 size={12} /> Player
            </button>
            <button
              onClick={() => setView('deck')}
              className={view === 'deck'
                ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-accent text-white text-xs font-medium shadow-sm'
                : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-app-muted hover:text-app-text text-xs font-medium transition-colors'}
            >
              <Sliders size={12} /> DJ Deck
            </button>
          </div>

          {/* Guild selector */}
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
                                                 text-app-muted pointer-events-none" />
            </div>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      {view === 'deck' ? (
        <DjDeck status={status} token={token} guildId={guildId} onRefresh={poll} />
      ) : (
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">

            {/* Left column */}
            <div className="flex flex-col gap-6">
              <NowPlaying
                status={status}
                token={token}
                guildId={guildId}
                onRefresh={poll}
              />
              <AddToQueue
                token={token}
                guildId={guildId}
                channels={channels}
                channelId={channelId}
                onChannelChange={handleChannelChange}
                onRefresh={poll}
              />
              <BotSettings
                token={token}
                guildId={guildId}
              />
            </div>

            {/* Right column — queue */}
            <QueueCard
              queue={status?.queue ?? []}
              token={token}
              guildId={guildId}
              onRefresh={poll}
            />

          </div>
        </main>
      )}
    </div>
  )
}
