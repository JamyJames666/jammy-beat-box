import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Play, Pause, SkipForward, Square, Volume2, Music, X } from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import {
  pause, resume, skip, stop, setVolume, seek, setSpeed, setEffect, setEq, setCrossfade,
  remove, type PlayerStatus, type AudioEffect, type TrackInfo,
} from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

// ── Constants ─────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const
const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8] as const

const EFFECTS: { id: AudioEffect; label: string }[] = [
  { id: 'none',      label: 'FLAT'      },
  { id: 'bass',      label: 'BASS+'     },
  { id: 'treble',    label: 'TREBLE+'   },
  { id: 'reverb',    label: 'REVERB'    },
  { id: '8d',        label: '8D'        },
  { id: 'nightcore', label: 'NIGHTCORE' },
  { id: 'vaporwave', label: 'VAPOUR'    },
]

// ── Turntable ─────────────────────────────────────────────────────────────────

function Turntable({
  thumbnailUrl, isPlaying, size = 220,
}: { thumbnailUrl: string | null; isPlaying: boolean; size?: number }) {
  const rotation = useRef(0)
  const rafRef   = useRef<number | null>(null)
  const [angle, setAngle] = useState(0)

  useEffect(() => {
    const step = () => {
      if (isPlaying) { rotation.current = (rotation.current + 0.25) % 360; setAngle(rotation.current) }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying])

  return (
    <div className="relative flex items-center justify-center select-none" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full bg-violet-600/10 blur-2xl" />
      <div className="relative w-full h-full rounded-full" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="absolute inset-0 rounded-full bg-[#0e0e18]" />
        {[20, 32, 44, 56, 68, 80].map(r => (
          <div key={r} className="absolute rounded-full border border-[#1a1a2a]" style={{ inset: `${r / 2}%` }} />
        ))}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/5 to-transparent" />
        <div className="absolute inset-[27%] rounded-full overflow-hidden ring-1 ring-white/10">
          {thumbnailUrl
            ? <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-app-accent/20 flex items-center justify-center"><Music size={size / 8} className="text-app-accent" /></div>}
        </div>
        <div className="absolute inset-[48%] bg-[#111] rounded-full ring-1 ring-white/10" />
      </div>
    </div>
  )
}

// ── Waveform ──────────────────────────────────────────────────────────────────

function Waveform({ pct, songKey, onSeek }: { pct: number; songKey: string; onSeek: (f: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null)
  const heights = useMemo(() => {
    const seed = songKey.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return Array.from({ length: 64 }, (_, i) => Math.max(0.1, Math.min(1, Math.abs(Math.sin((i + seed) * 0.7) * 0.5 + Math.sin((i + seed) * 1.3) * 0.3 + 0.4))))
  }, [songKey])
  return (
    <div ref={barRef} onClick={e => { const r = barRef.current?.getBoundingClientRect(); if (r) onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))) }}
      className="flex items-center gap-[2px] h-10 cursor-pointer group">
      {heights.map((h, i) => (
        <div key={i}
          className={cn('flex-1 rounded-full transition-colors', i / heights.length < pct / 100 ? 'bg-app-accent' : 'bg-app-border group-hover:bg-app-muted/30')}
          style={{ height: `${h * 100}%` }} />
      ))}
    </div>
  )
}

// ── EQ Band ───────────────────────────────────────────────────────────────────

function EqBand({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[9px] font-bold tracking-widest text-app-muted">{label}</span>
      <Slider.Root orientation="vertical" className="relative flex flex-col items-center select-none touch-none w-3" style={{ height: 80 }}
        min={-12} max={12} step={1} value={[value]} onValueChange={v => onChange(v[0])}>
        <Slider.Track className="bg-app-border relative grow rounded-full w-1">
          <Slider.Range className={cn('absolute rounded-full w-full', value > 0 ? 'bg-app-accent' : 'bg-violet-400')} />
        </Slider.Track>
        <Slider.Thumb className="block w-3.5 h-3.5 bg-white rounded-full shadow ring-2 ring-app-accent cursor-grab focus:outline-none" />
      </Slider.Root>
      <span className={cn('text-[9px] tabular-nums font-mono', value > 0 ? 'text-app-accent' : value < 0 ? 'text-violet-400' : 'text-app-muted')}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  )
}

// ── Queue Row (compact) ───────────────────────────────────────────────────────

function QueueRow({ item, index, token, guildId, onRefresh }: { item: TrackInfo; index: number; token: string; guildId: string; onRefresh: () => void }) {
  const handleRemove = async () => {
    await remove(token, guildId, index + 1).catch(() => null)
    onRefresh()
  }
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-app-panel/60 group transition-colors">
      <span className="text-[10px] text-app-border w-5 text-right tabular-nums flex-shrink-0">{index + 1}</span>
      {item.thumbnailUrl
        ? <img src={item.thumbnailUrl} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
        : <div className="w-8 h-8 rounded-md bg-app-border flex items-center justify-center flex-shrink-0"><Music size={12} className="text-app-muted" /></div>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-app-text truncate font-medium">{item.title}</p>
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] text-app-muted truncate">{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>
      <span className="text-[10px] text-app-muted tabular-nums flex-shrink-0 font-mono">{fmtTime(item.length)}</span>
      <button onClick={handleRemove} className="opacity-0 group-hover:opacity-100 text-app-muted hover:text-app-danger transition-all p-0.5"><X size={12} /></button>
    </div>
  )
}

// ── Main DJ Deck ──────────────────────────────────────────────────────────────

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function DjDeck({ status, token, guildId, onRefresh }: Props) {
  // Smooth position
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songKey,  setSongKey]  = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!status?.nowPlaying) { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } return }
    const np = status.nowPlaying; const playing = status.status === 'PLAYING'; const srvPos = status.position ?? 0
    if (np.url !== songKey) { setSongKey(np.url); setLocalPos(srvPos); setLocalLen(np.length); if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
    else { setLocalLen(np.length); if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos) }
    if (playing && !tickRef.current) tickRef.current = setInterval(() => setLocalPos(p => Math.min(p + 1, np.length)), 1000)
    else if (!playing && tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Local EQ (don't re-seek on every drag)
  const [eqLocal, setEqLocal] = useState({ bass: 0, mid: 0, treble: 0 })
  useEffect(() => { if (status?.eq) setEqLocal(status.eq) }, [status?.eq?.bass, status?.eq?.mid, status?.eq?.treble]) // eslint-disable-line react-hooks/exhaustive-deps

  // Volume
  const [volDrag, setVolDrag] = useState(false)
  const [volLocal, setVolLocal] = useState(100)
  useEffect(() => { if (!volDrag && status?.volume !== undefined) setVolLocal(status.volume) }, [status?.volume, volDrag])

  const isPlaying     = status?.status === 'PLAYING'
  const active        = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np            = status?.nowPlaying ?? null
  const nextTrack     = status?.queue?.[0] ?? null
  const queue         = status?.queue ?? []
  const currentSpeed  = status?.speed ?? 1
  const currentFx     = status?.effect ?? 'none'
  const currentXfade  = status?.crossfade ?? 0
  const pct           = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }
  const handleSpeed = async (s: number) => { await setSpeed(token, guildId, s).catch(() => null); onRefresh() }
  const handleFx    = async (fx: AudioEffect) => { await setEffect(token, guildId, fx).catch(() => null); onRefresh() }
  const handleXfade = async (s: number) => { await setCrossfade(token, guildId, s).catch(() => null); onRefresh() }

  const handleSeek = useCallback(async (f: number) => {
    const pos = Math.round(f * localLen); setLocalPos(pos)
    await seek(token, guildId, pos).catch(() => null); onRefresh()
  }, [localLen, token, guildId, onRefresh])

  const handleVolCommit = useCallback(async (v: number[]) => {
    setVolDrag(false); await setVolume(token, guildId, v[0]).catch(() => null); onRefresh()
  }, [token, guildId, onRefresh])

  const handleEqCommit = useCallback(async () => {
    await setEq(token, guildId, eqLocal.bass, eqLocal.mid, eqLocal.treble).catch(() => null); onRefresh()
  }, [token, guildId, eqLocal, onRefresh])

  return (
    <div className="flex flex-col h-[calc(100vh-61px)] bg-[#070710] overflow-hidden">

      {/* ── Top deck area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT: Current song turntable + controls */}
        <div className="flex flex-col items-center justify-center gap-4 p-6 border-r border-app-border/30 w-64 flex-shrink-0">
          <div className="text-[9px] font-bold tracking-widest text-app-muted uppercase">Now Playing</div>
          <Turntable thumbnailUrl={np?.thumbnailUrl ?? null} isPlaying={isPlaying} size={180} />
          <div className="text-center min-w-0 w-full px-2">
            <p className="text-sm font-bold text-white truncate">{np?.title ?? '—'}</p>
            <p className="text-xs text-app-muted truncate">{np?.artist ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePause}
              className={cn('w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg',
                active ? 'bg-app-accent hover:bg-violet-500 text-white' : 'bg-app-panel text-app-muted')}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={handleSkip} className="w-9 h-9 rounded-full bg-app-panel hover:bg-app-border flex items-center justify-center text-app-muted hover:text-white transition-all"><SkipForward size={14} /></button>
            <button onClick={handleStop} className="w-9 h-9 rounded-full bg-app-panel hover:bg-app-border flex items-center justify-center text-app-muted hover:text-white transition-all"><Square size={14} /></button>
          </div>
        </div>

        {/* CENTER: Waveform + EQ + FX */}
        <div className="flex-1 flex flex-col gap-4 p-6 min-w-0 overflow-y-auto">
          {/* Waveform + time */}
          <div className="space-y-1">
            <Waveform pct={pct} songKey={songKey} onSeek={handleSeek} />
            <div className="flex justify-between text-[10px] text-app-muted font-mono px-1">
              <span>{fmtTime(localPos)}</span><span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* EQ */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase mb-3">Equalizer</p>
            <div className="flex items-end justify-around">
              {(['bass', 'mid', 'treble'] as const).map(b => (
                <EqBand key={b} label={b.toUpperCase()} value={eqLocal[b]} onChange={v => setEqLocal(p => ({ ...p, [b]: v }))} />
              ))}
            </div>
            <button onClick={handleEqCommit}
              className="mt-3 w-full text-[10px] py-1 rounded-lg bg-app-accent/10 hover:bg-app-accent/20 text-app-accent font-bold tracking-wider transition-colors">
              APPLY EQ
            </button>
          </div>

          {/* FX */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase mb-3">FX Presets</p>
            <div className="grid grid-cols-4 gap-1.5">
              {EFFECTS.map(fx => (
                <button key={fx.id} onClick={() => handleFx(fx.id)}
                  className={cn('py-1.5 rounded-lg border text-[9px] font-bold tracking-wide transition-all',
                    currentFx === fx.id ? 'bg-app-accent border-app-accent text-white' : 'bg-app-panel border-app-border text-app-muted hover:text-white hover:border-app-muted/50')}>
                  {fx.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Next up + crossfade + tempo + volume */}
        <div className="flex flex-col gap-4 p-6 border-l border-app-border/30 w-56 flex-shrink-0 overflow-y-auto">

          {/* Next up */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase mb-3">Next Up</p>
            {nextTrack ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <Turntable thumbnailUrl={nextTrack.thumbnailUrl} isPlaying={false} size={80} />
                <div className="min-w-0 w-full">
                  <p className="text-xs font-semibold text-app-text truncate">{nextTrack.title}</p>
                  <p className="text-[10px] text-app-muted truncate">{nextTrack.artist}</p>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-app-muted text-center">Queue empty</p>
            )}
          </div>

          {/* Crossfade */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase mb-3">Crossfade</p>
            <div className="grid grid-cols-5 gap-1">
              {CROSSFADE_OPTIONS.map(s => (
                <button key={s} onClick={() => handleXfade(s)}
                  className={cn('py-1 rounded-lg border text-[9px] font-bold tracking-wide transition-all',
                    currentXfade === s ? 'bg-app-accent border-app-accent text-white' : 'bg-app-panel border-app-border text-app-muted hover:text-white hover:border-app-muted/50')}>
                  {s}s
                </button>
              ))}
            </div>
          </div>

          {/* Tempo */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase mb-3">Tempo</p>
            <div className="flex flex-col gap-1">
              {SPEED_OPTIONS.map(s => (
                <button key={s} onClick={() => handleSpeed(s)}
                  className={cn('flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs font-mono font-medium transition-all',
                    currentSpeed === s ? 'bg-app-accent border-app-accent text-white' : 'bg-app-panel border-app-border text-app-muted hover:text-white')}>
                  <span>{s}×</span>
                  <span className="text-[8px] opacity-60">{s === 0.75 ? 'SLOW' : s === 1 ? 'NORM' : s === 1.25 ? 'FAST' : s === 1.5 ? 'HYPR' : '2×'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Volume */}
          <div className="bg-app-surface border border-app-border rounded-xl p-4 flex flex-col gap-2 flex-1">
            <p className="text-[9px] font-bold tracking-widest text-app-muted uppercase">Volume</p>
            <div className="flex items-center gap-2">
              <Volume2 size={12} className="text-app-muted flex-shrink-0" />
              <Slider.Root className="relative flex items-center select-none touch-none flex-1 h-4"
                min={0} max={200} step={1} value={[volLocal]}
                onValueChange={v => { setVolDrag(true); setVolLocal(v[0]) }}
                onValueCommit={handleVolCommit}>
                <Slider.Track className="bg-app-border relative grow rounded-full h-1.5">
                  <Slider.Range className="absolute bg-app-accent rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb className="block w-3.5 h-3.5 bg-white rounded-full shadow ring-2 ring-app-accent cursor-grab focus:outline-none" />
              </Slider.Root>
              <span className="text-[10px] text-app-muted w-7 text-right tabular-nums">{volLocal}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Queue strip ── */}
      <div className="border-t border-app-border/50 bg-app-surface/50 flex flex-col" style={{ maxHeight: 260 }}>
        <div className="flex items-center gap-2 px-4 py-2 border-b border-app-border/30 flex-shrink-0">
          <span className="text-[10px] font-bold tracking-widest text-app-muted uppercase">Queue</span>
          {queue.length > 0 && (
            <span className="text-[10px] text-app-border">{queue.length} {queue.length === 1 ? 'song' : 'songs'}</span>
          )}
        </div>
        <div className="overflow-y-auto px-2 py-1">
          {queue.length === 0
            ? <p className="text-xs text-app-muted text-center py-4">Queue is empty</p>
            : queue.map((item, i) => (
              <QueueRow key={`${item.url}-${i}`} item={item} index={i} token={token} guildId={guildId} onRefresh={onRefresh} />
            ))}
        </div>
      </div>

    </div>
  )
}
