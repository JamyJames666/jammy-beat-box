/**
 * DJ Deck v3 — Professional Pioneer/Serato-style interface.
 *
 * Layout: dual waveform bar → 3-column deck (A | Mixer | B) → queue strip.
 * All audio control uses existing API endpoints; no backend changes required.
 */

import {
  useState, useEffect, useRef, useCallback, useMemo,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Play, Pause, SkipForward, Square, Volume2, Music, X, Shuffle, Trash2 } from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import {
  pause, resume, skip, stop, setVolume, seek, setSpeed, setEffect, setEq,
  setCrossfade, remove, shuffle, clearQueue,
  type PlayerStatus, type AudioEffect, type TrackInfo,
} from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SPEEDS: number[] = [0.75, 1, 1.25, 1.5, 2]
const EFFECTS: { id: AudioEffect; label: string }[] = [
  { id: 'none',      label: 'OFF'       },
  { id: 'bass',      label: 'BASS+'     },
  { id: 'treble',    label: 'HI+'       },
  { id: 'reverb',    label: 'REVERB'    },
  { id: '8d',        label: '8D'        },
  { id: 'nightcore', label: 'NIGHTCORE' },
  { id: 'vaporwave', label: 'VAPOUR'    },
]

// Hot cue seek positions (as fraction of song)
const HOT_CUE_PCTS = [0, 0.25, 0.5, 0.75]
const HOT_CUE_COLORS = ['#f97316', '#06b6d4', '#a855f7', '#eab308']
const HOT_CUE_LABELS = ['A', 'B', 'C', 'D']

// ─────────────────────────────────────────────────────────────────────────────
// LcdDisplay
// ─────────────────────────────────────────────────────────────────────────────

function LcdDisplay({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="rounded px-2 py-1 text-center" style={{ background: '#060e06', minWidth: 72 }}>
      <div className="text-[9px] font-mono tracking-widest" style={{ color: '#86efac', opacity: 0.6 }}>{top}</div>
      <div className="text-sm font-mono font-bold tracking-wide" style={{ color: '#86efac' }}>{bottom}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VuMeter
// ─────────────────────────────────────────────────────────────────────────────

const SEGMENTS = 12

function VuMeter({ isPlaying, deckColor }: { isPlaying: boolean; deckColor: string }) {
  const [level, setLevel] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying) { setLevel(0); return }
    const tick = () => {
      setLevel(Math.max(0, Math.min(SEGMENTS, Math.round(SEGMENTS * (0.4 + Math.random() * 0.55))))  )
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying])

  return (
    <div className="flex flex-col-reverse gap-[2px]" style={{ width: 10 }}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const lit = i < level
        const color = i >= 10 ? '#ef4444' : i >= 8 ? '#eab308' : deckColor
        return (
          <div key={i} style={{
            height: 3,
            borderRadius: 1,
            background: lit ? color : '#1a1a28',
            transition: 'background 50ms',
          }} />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EqKnob — drag-to-rotate SVG knob
// ─────────────────────────────────────────────────────────────────────────────

interface EqKnobProps {
  label: string
  value: number         // -12 to +12
  color: string
  onChange: (v: number) => void
  onCommit: () => void
}

function EqKnob({ label, value, color, onChange, onCommit }: EqKnobProps) {
  const startY = useRef<number | null>(null)
  const startVal = useRef(value)

  // -12 → -135deg from top; +12 → +135deg from top
  const angle = (value / 12) * 135

  const handlePointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    startY.current = e.clientY
    startVal.current = value
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (startY.current === null) return
    const delta = (startY.current - e.clientY) / 3   // 3px per 1 dB
    const next = Math.max(-12, Math.min(12, Math.round(startVal.current + delta)))
    if (next !== value) onChange(next)
  }

  const handlePointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    startY.current = null
    onCommit()
  }

  const cx = 24; const cy = 24; const r = 18
  const rad = ((angle - 90) * Math.PI) / 180
  const ix = cx + r * 0.55 * Math.cos(rad)
  const iy = cy + r * 0.55 * Math.sin(rad)
  const ox = cx + r * Math.cos(rad)
  const oy = cy + r * Math.sin(rad)

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <span className="text-[9px] font-bold tracking-widest" style={{ color }}>{value > 0 ? `+${value}` : value}</span>
      <svg
        width={48} height={48}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
      >
        {/* Knob body */}
        <circle cx={cx} cy={cy} r={r} fill="url(#knob-grad)" stroke="#333" strokeWidth={1} />
        {/* Arc track */}
        <circle cx={cx} cy={cy} r={r - 4} fill="none" stroke="#111" strokeWidth={5} />
        {/* Indicator line */}
        <line x1={ix} y1={iy} x2={ox} y2={oy} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        <defs>
          <radialGradient id="knob-grad" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#3a3a50" />
            <stop offset="100%" stopColor="#16162a" />
          </radialGradient>
        </defs>
      </svg>
      <span className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: '#7a7a9a' }}>{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DualWaveform
// ─────────────────────────────────────────────────────────────────────────────

function DualWaveform({
  pct, aSongKey, bSongKey, onSeek,
}: {
  pct: number
  aSongKey: string
  bSongKey: string
  onSeek: (f: number) => void
}) {
  const BARS = 80
  const seed = (key: string) => key.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const heights = (key: string) => Array.from({ length: BARS }, (_, i) => {
    const s = seed(key)
    return Math.max(0.08, Math.min(1, Math.abs(Math.sin((i + s) * 0.7) * 0.5 + Math.sin((i + s) * 1.3) * 0.3 + 0.4)))
  })

  const aHeights = useMemo(() => heights(aSongKey), [aSongKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const bHeights = useMemo(() => heights(bSongKey), [bSongKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const aRef = useRef<HTMLDivElement>(null)
  const handleClickA = (e: React.MouseEvent) => {
    const r = aRef.current?.getBoundingClientRect()
    if (!r) return
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
  }

  return (
    <div className="flex w-full gap-1" style={{ height: 56 }}>
      {/* Deck A waveform */}
      <div ref={aRef} onClick={handleClickA}
        className="flex-1 flex items-center gap-[2px] cursor-pointer group relative" style={{ height: 56 }}>
        {aHeights.map((h, i) => {
          const played = i / BARS < pct / 100
          return (
            <div key={i} className="flex-1 rounded-full" style={{
              height: `${h * 100}%`,
              background: played ? '#3b82f6' : '#1e2a3a',
              transition: 'background 0.3s',
            }} />
          )
        })}
        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-white/70 rounded" style={{ left: `${pct}%`, transition: 'left 0.5s linear' }} />
      </div>

      {/* Divider */}
      <div className="w-px bg-app-border flex-shrink-0" />

      {/* Deck B waveform */}
      <div className="flex-1 flex items-center gap-[2px]" style={{ height: 56 }}>
        {bHeights.map((h, i) => (
          <div key={i} className="flex-1 rounded-full" style={{
            height: `${h * 100}%`,
            background: '#3a2010',
          }} />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Turntable
// ─────────────────────────────────────────────────────────────────────────────

function Turntable({ thumbnailUrl, isPlaying, size, deckColor }: {
  thumbnailUrl: string | null
  isPlaying: boolean
  size: number
  deckColor: string
}) {
  const rotation = useRef(0)
  const raf = useRef<number | null>(null)
  const [angle, setAngle] = useState(0)

  useEffect(() => {
    const tick = () => {
      if (isPlaying) { rotation.current = (rotation.current + 0.2) % 360; setAngle(rotation.current) }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [isPlaying])

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full blur-xl opacity-20" style={{ background: deckColor }} />
      <div style={{ transform: `rotate(${angle}deg)`, width: size, height: size, position: 'relative' }}>
        {/* Disc */}
        <div className="absolute inset-0 rounded-full" style={{ background: '#0a0a14' }} />
        {/* Grooves */}
        {[15, 25, 35, 45, 55, 65, 75].map(r => (
          <div key={r} className="absolute rounded-full" style={{
            inset: `${r / 2}%`,
            border: '1px solid #18182a',
          }} />
        ))}
        {/* Sheen */}
        <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.06) 0%, transparent 60%)' }} />
        {/* Center label */}
        <div className="absolute rounded-full overflow-hidden" style={{ inset: '27%', boxShadow: `0 0 0 2px ${deckColor}40` }}>
          {thumbnailUrl
            ? <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center" style={{ background: `${deckColor}20` }}>
                <Music size={size / 8} style={{ color: deckColor }} />
              </div>}
        </div>
        {/* Ring */}
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${deckColor}60` }} />
        {/* Spindle */}
        <div className="absolute rounded-full" style={{ inset: '48%', background: '#111', boxShadow: `0 0 0 1px ${deckColor}30` }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hot Cue Pads
// ─────────────────────────────────────────────────────────────────────────────

function HotCuePads({ localLen, token, guildId, onRefresh }: {
  localLen: number; token: string; guildId: string; onRefresh: () => void
}) {
  const [active, setActive] = useState<number | null>(null)
  const handleCue = async (i: number) => {
    if (i < HOT_CUE_PCTS.length) {
      const pos = Math.round(HOT_CUE_PCTS[i] * localLen)
      setActive(i)
      await seek(token, guildId, pos).catch(() => null)
      onRefresh()
      setTimeout(() => setActive(null), 200)
    }
  }
  return (
    <div className="grid grid-cols-4 gap-1">
      {Array.from({ length: 8 }, (_, i) => {
        const isCue = i < HOT_CUE_PCTS.length
        const color = isCue ? HOT_CUE_COLORS[i] : '#252535'
        const isActive = active === i
        return (
          <button
            key={i}
            onClick={() => handleCue(i)}
            style={{
              background: isActive ? color : `${color}22`,
              border: `1px solid ${isCue ? color : '#252535'}`,
              boxShadow: isActive ? `0 0 8px ${color}` : 'none',
            }}
            className="h-7 rounded text-[9px] font-bold tracking-widest transition-all"
          >
            <span style={{ color: isCue ? color : '#3a3a4a' }}>
              {isCue ? HOT_CUE_LABELS[i] : '·'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop Buttons (decorative)
// ─────────────────────────────────────────────────────────────────────────────

function LoopButtons() {
  const [active, setActive] = useState<string | null>(null)
  const buttons = ['IN', 'OUT', '4', '8', '16', '×2']
  return (
    <div className="flex gap-1">
      {buttons.map(b => (
        <button
          key={b}
          onClick={() => setActive(active === b ? null : b)}
          className={cn(
            'h-6 px-1.5 rounded text-[9px] font-bold tracking-wider transition-all border',
            active === b
              ? 'bg-green-600 border-green-400 text-white'
              : 'bg-app-panel border-app-border text-app-muted hover:text-white',
          )}
        >{b}</button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Row
// ─────────────────────────────────────────────────────────────────────────────

function QueueRow({ item, index, token, guildId, onRefresh }: {
  item: TrackInfo; index: number; token: string; guildId: string; onRefresh: () => void
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded hover:bg-app-panel/60 group transition-colors">
      <span className="text-[10px] text-app-border w-4 text-right tabular-nums flex-shrink-0">{index + 1}</span>
      {item.thumbnailUrl
        ? <img src={item.thumbnailUrl} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
        : <div className="w-7 h-7 rounded bg-app-border flex items-center justify-center flex-shrink-0"><Music size={10} className="text-app-muted" /></div>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-app-text truncate font-medium leading-tight">{item.title}</p>
        <div className="flex items-center gap-1">
          <p className="text-[10px] text-app-muted truncate">{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>
      <span className="text-[10px] text-app-muted tabular-nums flex-shrink-0 font-mono">{fmtTime(item.length)}</span>
      <button
        onClick={async () => { await remove(token, guildId, index + 1).catch(() => null); onRefresh() }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-app-muted hover:text-app-danger transition-all"
      ><X size={11} /></button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main DjDeckV3
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function DjDeckV3({ status, token, guildId, onRefresh }: Props) {
  // ── Smooth position ──────────────────────────────────────────────────────
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songKey,  setSongKey]  = useState('')
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const np = status?.nowPlaying
    if (!np) { if (tick.current) { clearInterval(tick.current); tick.current = null } return }
    const playing = status?.status === 'PLAYING'
    const srvPos = status?.position ?? 0
    if (np.url !== songKey) { setSongKey(np.url); setLocalPos(srvPos); setLocalLen(np.length); if (tick.current) { clearInterval(tick.current); tick.current = null } }
    else { setLocalLen(np.length); if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos) }
    if (playing && !tick.current) tick.current = setInterval(() => setLocalPos(p => Math.min(p + 1, np.length)), 1000)
    else if (!playing && tick.current) { clearInterval(tick.current); tick.current = null }
    return () => { if (tick.current) { clearInterval(tick.current); tick.current = null } }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── EQ local state ───────────────────────────────────────────────────────
  const [eqLocal, setEqLocal] = useState({ bass: 0, mid: 0, treble: 0 })
  useEffect(() => { if (status?.eq) setEqLocal(status.eq) }, [status?.eq?.bass, status?.eq?.mid, status?.eq?.treble]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Volume ───────────────────────────────────────────────────────────────
  const [volDrag, setVolDrag] = useState(false)
  const [volLocal, setVolLocal] = useState(100)
  useEffect(() => { if (!volDrag && status?.volume !== undefined) setVolLocal(status.volume) }, [status?.volume, volDrag])

  // ── Crossfader ────────────────────────────────────────────────────────────
  const [xfadeLocal, setXfadeLocal] = useState(0)  // -8 to +8

  // ── Derived state ─────────────────────────────────────────────────────────
  const isPlaying    = status?.status === 'PLAYING'
  const active       = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np           = status?.nowPlaying ?? null
  const nextTrack    = status?.queue?.[0] ?? null
  const queue        = status?.queue ?? []
  const currentSpeed = status?.speed  ?? 1
  const currentFx    = status?.effect ?? 'none'
  const pct          = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0
  const remaining    = localLen - localPos

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handlePause  = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip   = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop   = async () => { await stop(token, guildId).catch(() => null); onRefresh() }
  const handleSpeed  = async (s: number) => { await setSpeed(token, guildId, s).catch(() => null); onRefresh() }
  const handleFx     = async (fx: AudioEffect) => { await setEffect(token, guildId, fx).catch(() => null); onRefresh() }
  const handleShuffle = async () => { await shuffle(token, guildId).catch(() => null); onRefresh() }
  const handleClear   = async () => { await clearQueue(token, guildId).catch(() => null); onRefresh() }

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

  const handleXfaderCommit = useCallback(async (v: number[]) => {
    const seconds = Math.abs(v[0])
    setXfadeLocal(v[0])
    await setCrossfade(token, guildId, seconds).catch(() => null); onRefresh()
  }, [token, guildId, onRefresh])

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 61px)', background: '#06060c', overflow: 'hidden' }}>

      {/* ── Dual waveform bar ── */}
      <div style={{ background: '#0a0a14', borderBottom: '1px solid #1a1a2a', padding: '8px 12px 4px' }}>
        <DualWaveform
          pct={pct}
          aSongKey={songKey}
          bSongKey={nextTrack?.url ?? ''}
          onSeek={handleSeek}
        />
        <div className="flex justify-between text-[9px] font-mono mt-1" style={{ color: '#3b82f6' }}>
          <span>{fmtTime(localPos)}</span>
          <span style={{ color: '#7a7a9a' }}>DECK A</span>
          <span style={{ color: '#7a7a9a' }}>·</span>
          <span style={{ color: '#7a7a9a' }}>DECK B</span>
          <span style={{ color: '#f97316' }}>{nextTrack ? fmtTime(nextTrack.length) : '--:--'}</span>
        </div>
      </div>

      {/* ── Main deck area ── */}
      <div className="flex flex-1 min-h-0" style={{ borderBottom: '1px solid #1a1a2a' }}>

        {/* ─────────────── DECK A ─────────────── */}
        <div className="flex flex-col gap-3 p-4 flex-shrink-0" style={{ width: 260, borderRight: '1px solid #1a1a2a', overflow: 'auto' }}>
          {/* Header badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: isPlaying ? '#22c55e' : '#7a7a9a', boxShadow: isPlaying ? '0 0 6px #22c55e' : 'none' }} />
              <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: '#3b82f6' }}>DECK A</span>
            </div>
            {np?.source && <SourceBadge source={np.source} />}
          </div>

          {/* Turntable */}
          <div className="flex justify-center">
            <Turntable thumbnailUrl={np?.thumbnailUrl ?? null} isPlaying={isPlaying} size={190} deckColor="#3b82f6" />
          </div>

          {/* Track info + LCD */}
          <div className="space-y-1">
            <p className="text-sm font-bold text-white truncate leading-tight">{np?.title ?? '—'}</p>
            <p className="text-xs truncate" style={{ color: '#7a7a9a' }}>{np?.artist ?? '—'}</p>
            <div className="flex gap-1.5 mt-1">
              <LcdDisplay top="REMAIN" bottom={active ? `-${fmtTime(remaining)}` : '--:--'} />
              <LcdDisplay top="BPM" bottom="---" />
            </div>
          </div>

          {/* Hot cues */}
          <div>
            <p className="text-[9px] font-bold tracking-[0.15em] mb-1" style={{ color: '#3b6a9a' }}>HOT CUES</p>
            <HotCuePads localLen={localLen} token={token} guildId={guildId} onRefresh={onRefresh} />
          </div>

          {/* Loop buttons */}
          <div>
            <p className="text-[9px] font-bold tracking-[0.15em] mb-1" style={{ color: '#3b6a9a' }}>LOOP</p>
            <LoopButtons />
          </div>

          {/* Transport */}
          <div className="flex items-center gap-2">
            <button onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all"
              style={{
                width: 44, height: 44,
                background: active ? '#3b82f6' : '#1a1a28',
                border: `2px solid ${active ? '#3b82f6' : '#2a2a3a'}`,
                color: active ? 'white' : '#7a7a9a',
                boxShadow: active ? '0 0 12px #3b82f620' : 'none',
              }}>
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={handleSkip} className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-app-muted hover:text-white" style={{ background: '#1a1a28', border: '1px solid #2a2a3a' }}><SkipForward size={13} /></button>
            <button onClick={handleStop}  className="w-8 h-8 rounded-full flex items-center justify-center transition-all text-app-muted hover:text-white" style={{ background: '#1a1a28', border: '1px solid #2a2a3a' }}><Square size={13} /></button>
          </div>
        </div>

        {/* ─────────────── MIXER ─────────────── */}
        <div className="flex flex-col gap-3 p-4 flex-1 min-w-0" style={{ overflow: 'auto' }}>
          <p className="text-[9px] font-bold tracking-[0.25em] text-center" style={{ color: '#7a7a9a' }}>MIXER</p>

          {/* EQ section */}
          <div className="rounded-lg p-3" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }}>
            <div className="flex justify-between mb-2">
              <span className="text-[9px] font-bold tracking-widest" style={{ color: '#3b82f6' }}>CH A</span>
              <span className="text-[9px] font-bold tracking-widest" style={{ color: '#f97316' }}>CH B</span>
            </div>
            <div className="flex items-start justify-around gap-2">
              {/* VU A */}
              <VuMeter isPlaying={isPlaying} deckColor="#3b82f6" />
              {/* EQ A knobs */}
              <div className="flex gap-3">
                <EqKnob label="HI"  value={eqLocal.treble} color="#3b82f6" onChange={v => setEqLocal(p => ({...p, treble: v}))} onCommit={handleEqCommit} />
                <EqKnob label="MID" value={eqLocal.mid}    color="#3b82f6" onChange={v => setEqLocal(p => ({...p, mid: v}))}    onCommit={handleEqCommit} />
                <EqKnob label="LOW" value={eqLocal.bass}   color="#3b82f6" onChange={v => setEqLocal(p => ({...p, bass: v}))}   onCommit={handleEqCommit} />
              </div>
              {/* Divider */}
              <div style={{ width: 1, alignSelf: 'stretch', background: '#1a1a2a' }} />
              {/* EQ B knobs (decorative — mirrors A) */}
              <div className="flex gap-3">
                <EqKnob label="HI"  value={0} color="#f97316" onChange={() => null} onCommit={() => null} />
                <EqKnob label="MID" value={0} color="#f97316" onChange={() => null} onCommit={() => null} />
                <EqKnob label="LOW" value={0} color="#f97316" onChange={() => null} onCommit={() => null} />
              </div>
              {/* VU B */}
              <VuMeter isPlaying={false} deckColor="#f97316" />
            </div>
          </div>

          {/* Channel faders */}
          <div className="rounded-lg p-3 flex justify-around" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }}>
            {/* CH A fader */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px]" style={{ color: '#3b82f6' }}>{volLocal}</span>
              <Slider.Root orientation="vertical" className="relative flex flex-col items-center select-none touch-none" style={{ height: 80, width: 14 }}
                min={0} max={200} step={1} value={[volLocal]}
                onValueChange={v => { setVolDrag(true); setVolLocal(v[0]) }}
                onValueCommit={handleVolCommit}>
                <Slider.Track className="relative grow rounded-full" style={{ width: 4, background: '#1a1a2a' }}>
                  <Slider.Range className="absolute rounded-full w-full" style={{ background: '#3b82f6' }} />
                </Slider.Track>
                <Slider.Thumb className="block w-5 h-3 rounded cursor-grab focus:outline-none" style={{ background: '#e2e2f0', border: '1px solid #aaa' }} />
              </Slider.Root>
              <span className="text-[8px] font-bold" style={{ color: '#3b82f6' }}>A</span>
            </div>

            {/* FX and tempo column */}
            <div className="flex flex-col gap-2 flex-1 mx-4">
              {/* FX row */}
              <div>
                <p className="text-[9px] font-bold tracking-widest mb-1 text-center" style={{ color: '#7a7a9a' }}>FX</p>
                <div className="grid grid-cols-4 gap-1">
                  {EFFECTS.slice(0, 8).map(fx => (
                    <button key={fx.id} onClick={() => handleFx(fx.id)}
                      className={cn('py-1 rounded text-[8px] font-bold tracking-wide border transition-all',
                        currentFx === fx.id ? 'text-white' : 'text-app-muted hover:text-white')}
                      style={{ background: currentFx === fx.id ? '#7c3aed' : '#0e0e1a', borderColor: currentFx === fx.id ? '#7c3aed' : '#1a1a2a' }}>
                      {fx.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tempo buttons */}
              <div>
                <p className="text-[9px] font-bold tracking-widest mb-1 text-center" style={{ color: '#7a7a9a' }}>TEMPO</p>
                <div className="flex gap-1 justify-center">
                  {SPEEDS.map(s => (
                    <button key={s} onClick={() => handleSpeed(s)}
                      className="px-2 py-1 rounded text-[9px] font-mono font-bold border transition-all"
                      style={{
                        background: currentSpeed === s ? '#7c3aed' : '#0e0e1a',
                        borderColor: currentSpeed === s ? '#7c3aed' : '#1a1a2a',
                        color: currentSpeed === s ? 'white' : '#7a7a9a',
                      }}>{s}×</button>
                  ))}
                </div>
              </div>

              {/* Crossfader */}
              <div>
                <p className="text-[9px] font-bold tracking-widest mb-2 text-center" style={{ color: '#7a7a9a' }}>CROSSFADE</p>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold" style={{ color: '#3b82f6' }}>A</span>
                  <Slider.Root className="relative flex items-center select-none touch-none flex-1 h-4"
                    min={-8} max={8} step={1} value={[xfadeLocal]}
                    onValueChange={v => setXfadeLocal(v[0])}
                    onValueCommit={handleXfaderCommit}>
                    <Slider.Track className="relative grow rounded-full h-2" style={{ background: '#1a1a2a' }}>
                      <Slider.Range className="absolute rounded-full h-full" style={{ background: '#7c3aed' }} />
                    </Slider.Track>
                    <Slider.Thumb className="block w-5 h-5 rounded cursor-grab focus:outline-none" style={{ background: '#e2e2f0', border: '2px solid #7c3aed' }} />
                  </Slider.Root>
                  <span className="text-[9px] font-bold" style={{ color: '#f97316' }}>B</span>
                </div>
                <p className="text-[9px] text-center mt-1" style={{ color: '#7a7a9a' }}>
                  {xfadeLocal === 0 ? 'No fade' : `${Math.abs(xfadeLocal)}s fade`}
                </p>
              </div>
            </div>

            {/* CH B fader (decorative) */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[9px]" style={{ color: '#f97316' }}>100</span>
              <Slider.Root orientation="vertical" className="relative flex flex-col items-center select-none touch-none" style={{ height: 80, width: 14 }}
                min={0} max={200} step={1} value={[100]} onValueChange={() => null} onValueCommit={() => null}>
                <Slider.Track className="relative grow rounded-full" style={{ width: 4, background: '#1a1a2a' }}>
                  <Slider.Range className="absolute rounded-full w-full" style={{ background: '#f97316' }} />
                </Slider.Track>
                <Slider.Thumb className="block w-5 h-3 rounded cursor-not-allowed focus:outline-none" style={{ background: '#e2e2f0', border: '1px solid #aaa', opacity: 0.5 }} />
              </Slider.Root>
              <span className="text-[8px] font-bold" style={{ color: '#f97316' }}>B</span>
            </div>
          </div>

          {/* Volume master */}
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }}>
            <Volume2 size={12} className="text-app-muted flex-shrink-0" />
            <Slider.Root className="relative flex items-center select-none touch-none flex-1 h-4"
              min={0} max={200} step={1} value={[volLocal]}
              onValueChange={v => { setVolDrag(true); setVolLocal(v[0]) }}
              onValueCommit={handleVolCommit}>
              <Slider.Track className="relative grow rounded-full h-1.5" style={{ background: '#1a1a2a' }}>
                <Slider.Range className="absolute rounded-full h-full" style={{ background: '#7c3aed' }} />
              </Slider.Track>
              <Slider.Thumb className="block w-4 h-4 bg-white rounded-full shadow cursor-grab focus:outline-none ring-2 ring-app-accent" />
            </Slider.Root>
            <span className="text-[10px] tabular-nums font-mono" style={{ color: '#7a7a9a', minWidth: 28 }}>{volLocal}</span>
          </div>
        </div>

        {/* ─────────────── DECK B ─────────────── */}
        <div className="flex flex-col gap-3 p-4 flex-shrink-0" style={{ width: 220, borderLeft: '1px solid #1a1a2a', overflow: 'auto' }}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: '#f97316', opacity: 0.5 }} />
              <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: '#f97316' }}>DECK B</span>
            </div>
            {nextTrack?.source && <SourceBadge source={nextTrack.source} />}
          </div>

          {/* Turntable */}
          <div className="flex justify-center">
            <Turntable thumbnailUrl={nextTrack?.thumbnailUrl ?? null} isPlaying={false} size={155} deckColor="#f97316" />
          </div>

          {/* Track info */}
          <div className="space-y-1">
            <p className="text-sm font-bold text-white truncate leading-tight">{nextTrack?.title ?? '—'}</p>
            <p className="text-xs truncate" style={{ color: '#7a7a9a' }}>{nextTrack?.artist ?? 'No next track'}</p>
            <LcdDisplay top="DURATION" bottom={nextTrack ? fmtTime(nextTrack.length) : '--:--'} />
          </div>

          {/* Hot cues (decorative for Deck B) */}
          <div>
            <p className="text-[9px] font-bold tracking-[0.15em] mb-1" style={{ color: '#7a4a20' }}>HOT CUES</p>
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-7 rounded" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }} />
              ))}
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#1a1a28', border: '2px solid #2a2a3a', color: '#7a7a9a' }}>
              <Play size={14} />
            </div>
            <button onClick={handleSkip} title="Load to Deck A (skip)"
              className="w-8 h-8 rounded-full flex items-center justify-center text-app-muted hover:text-white transition-all"
              style={{ background: '#1a1a28', border: '1px solid #2a2a3a' }}>
              <SkipForward size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Queue strip ── */}
      <div className="flex flex-col flex-shrink-0" style={{ maxHeight: 200 }}>
        <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0" style={{ background: '#0a0a14', borderBottom: '1px solid #1a1a2a' }}>
          <span className="text-[9px] font-bold tracking-[0.2em]" style={{ color: '#7a7a9a' }}>LIBRARY</span>
          {queue.length > 0 && <span className="text-[9px]" style={{ color: '#3a3a4a' }}>{queue.length} tracks</span>}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={handleShuffle} className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium text-app-muted hover:text-white transition-colors" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }}>
              <Shuffle size={10} /> Shuffle
            </button>
            <button onClick={handleClear} className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium text-app-muted hover:text-app-danger transition-colors" style={{ background: '#0e0e1a', border: '1px solid #1a1a2a' }}>
              <Trash2 size={10} /> Clear
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-2 py-1" style={{ background: '#08080f' }}>
          {queue.length === 0
            ? <p className="text-xs text-center py-3" style={{ color: '#3a3a4a' }}>Library empty — add songs from the Player tab</p>
            : queue.map((item, i) => (
              <QueueRow key={`${item.url}-${i}`} item={item} index={i} token={token} guildId={guildId} onRefresh={onRefresh} />
            ))}
        </div>
      </div>
    </div>
  )
}
