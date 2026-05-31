import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music } from 'lucide-react'
import { pause, resume, skip, stop, seek, setSpeed, setEffect, type PlayerStatus, type AudioEffect } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

// Each effect has a colour that shows when active
const EFFECTS: { id: AudioEffect; label: string; color: string }[] = [
  { id: 'none',      label: 'Normal',    color: 'bg-app-accent' },
  { id: 'bass',      label: 'Bass+',     color: 'bg-pink-500' },
  { id: 'treble',    label: 'Treble+',   color: 'bg-sky-500' },
  { id: 'reverb',    label: 'Reverb',    color: 'bg-cyan-500' },
  { id: '8d',        label: '8D',        color: 'bg-green-500' },
  { id: 'nightcore', label: 'Nightcore', color: 'bg-orange-500' },
  { id: 'vaporwave', label: 'Vapour',    color: 'bg-rose-400' },
]

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function NowPlaying({ status, token, guildId, onRefresh }: Props) {
  // ── Smooth local position counter ─────────────────────────────────────────
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songUrl,  setSongUrl]  = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }
    const np      = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos  = status.position ?? 0
    if (np.url !== songUrl) {
      setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick()
    } else {
      setLocalLen(np.length)
      if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos)
    }
    if (playing && !tickRef.current) {
      const rate = status.speed ?? 1
      tickRef.current = setInterval(() => setLocalPos(p => Math.min(p + rate, np.length)), 1000)
    } else if (!playing) { stopTick() }
    return stopTick
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPlaying     = status?.status === 'PLAYING'
  const active        = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np            = status?.nowPlaying ?? null
  const currentSpeed  = status?.speed  ?? 1
  const currentEffect = status?.effect ?? 'none'
  const pct           = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  const handlePause  = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip   = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop   = async () => { await stop(token, guildId).catch(() => null); onRefresh() }
  const handleSpeed  = async (s: number) => { await setSpeed(token, guildId, s).catch(() => null); onRefresh() }
  const handleEffect = async (fx: AudioEffect) => { await setEffect(token, guildId, fx).catch(() => null); onRefresh() }

  // ── Timeline click-to-seek ────────────────────────────────────────────────
  const progressRef = useRef<HTMLDivElement>(null)
  const handleProgressClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || localLen === 0) return
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * localLen)
    setLocalPos(position)
    await seek(token, guildId, position).catch(() => null)
    onRefresh()
  }, [active, localLen, token, guildId, onRefresh])

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest">
        Now Playing
      </h2>

      {!active ? (
        <div className="flex items-center gap-4 py-3">
          <div className="w-14 h-14 rounded-2xl bg-app-panel flex items-center justify-center flex-shrink-0">
            <Music size={20} className="text-app-muted" />
          </div>
          <div>
            <p className="text-app-text font-medium">Nothing playing</p>
            <p className="text-app-muted text-sm mt-0.5">Add a song to get started</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-4">
            {/* Thumbnail */}
            <div className="relative flex-shrink-0">
              {np?.thumbnailUrl ? (
                <img src={np.thumbnailUrl} alt={np.title}
                  className="w-24 h-24 rounded-2xl object-cover shadow-card"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-app-panel flex items-center justify-center">
                  <Music size={24} className="text-app-muted" />
                </div>
              )}
              <div className={cn('absolute bottom-2 right-2 flex items-end gap-[2px] h-4', !isPlaying && 'opacity-0')}>
                <span className="block w-[3px] bg-app-accent rounded-sm animate-bar" />
                <span className="block w-[3px] bg-app-accent rounded-sm animate-bar-2" />
                <span className="block w-[3px] bg-app-accent rounded-sm animate-bar-3" />
              </div>
            </div>

            {/* Song info + progress */}
            <div className="flex-1 min-w-0 space-y-1">
              <p className="font-semibold text-app-text text-base leading-snug truncate" title={np?.title}>
                {np?.title ?? '—'}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-app-muted truncate">{np?.artist ?? '—'}</p>
                {np?.source && <SourceBadge source={np.source} />}
              </div>
              <div className="pt-2 space-y-1">
                <div ref={progressRef} onClick={handleProgressClick}
                  className={cn('relative h-2 bg-app-border rounded-full overflow-hidden', active && 'cursor-pointer group')}
                  title="Click to seek">
                  <div className="h-full bg-app-accent rounded-full transition-[width] duration-1000 group-hover:opacity-80"
                    style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-app-muted">
                  <span>{fmtTime(localPos)}</span>
                  <span>{fmtTime(localLen)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button className={cn('btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm', isPlaying && 'border-app-accent/40 text-app-accent')} onClick={handlePause}>
              {isPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
            </button>
            <button className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm" onClick={handleSkip}>
              <SkipForward size={14} /> Skip
            </button>
            <button className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-sm" onClick={handleStop}>
              <Square size={14} /> Stop
            </button>
            {/* Speed */}
            <div className="flex items-center gap-1 ml-auto bg-app-panel rounded-lg p-0.5">
              {SPEED_OPTIONS.map(s => (
                <button key={s} onClick={() => handleSpeed(s)}
                  className={cn('text-xs px-2 py-1 rounded-md transition-all font-mono font-medium',
                    currentSpeed === s ? 'bg-app-surface text-app-text shadow-sm' : 'text-app-muted hover:text-app-text')}>
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* FX — single scrollable row, coloured active states */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <span className="text-[10px] font-bold tracking-widest text-app-muted uppercase">FX</span>
            {EFFECTS.map(fx => (
              <button key={fx.id} onClick={() => handleEffect(fx.id)}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full transition-all font-medium border',
                  currentEffect === fx.id
                    ? `${fx.color} text-white border-transparent shadow-sm`
                    : 'text-app-muted border-app-border hover:text-app-text hover:border-app-muted/40',
                )}>
                <span className="whitespace-nowrap">{fx.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
