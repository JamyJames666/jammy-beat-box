import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Play, Pause, SkipForward, Square, Volume2, Music } from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import {
  pause, resume, skip, stop, setVolume, seek, setSpeed, setEffect, setEq,
  type PlayerStatus, type AudioEffect,
} from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

// ── Constants ─────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

const EFFECTS: { id: AudioEffect; label: string; color: string }[] = [
  { id: 'none',      label: 'FLAT',      color: 'bg-app-panel border-app-border text-app-muted' },
  { id: 'bass',      label: 'BASS+',     color: 'bg-violet-900/60 border-violet-500 text-violet-200' },
  { id: 'treble',    label: 'TREBLE+',   color: 'bg-blue-900/60 border-blue-500 text-blue-200' },
  { id: 'reverb',    label: 'REVERB',    color: 'bg-cyan-900/60 border-cyan-500 text-cyan-200' },
  { id: '8d',        label: '8D',        color: 'bg-green-900/60 border-green-500 text-green-200' },
  { id: 'nightcore', label: 'NIGHTCORE', color: 'bg-pink-900/60 border-pink-500 text-pink-200' },
  { id: 'vaporwave', label: 'VAPORWAVE', color: 'bg-purple-900/60 border-purple-500 text-purple-200' },
]

// ── Turntable ─────────────────────────────────────────────────────────────────

function Turntable({ thumbnailUrl, isPlaying }: { thumbnailUrl: string | null; isPlaying: boolean }) {
  const rotation = useRef(0)
  const rafRef   = useRef<number | null>(null)
  const [angle, setAngle] = useState(0)

  useEffect(() => {
    const step = () => {
      if (isPlaying) {
        rotation.current = (rotation.current + 0.3) % 360
        setAngle(rotation.current)
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying])

  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Outer platter shadow */}
      <div className="absolute inset-0 rounded-full bg-violet-600/10 blur-3xl scale-110" />

      {/* Vinyl disc */}
      <div
        className="relative w-64 h-64 rounded-full"
        style={{ transform: `rotate(${angle}deg)` }}
      >
        {/* Base */}
        <div className="absolute inset-0 rounded-full bg-[#0e0e18] shadow-[inset_0_0_30px_rgba(0,0,0,0.8)]" />
        {/* Grooves */}
        {[20, 30, 40, 50, 60, 70, 80].map(r => (
          <div
            key={r}
            className="absolute rounded-full border border-[#1a1a2a]"
            style={{ inset: `${r / 2}%` }}
          />
        ))}
        {/* Sheen */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/5 to-transparent" />
        {/* Center label */}
        <div className="absolute inset-[28%] rounded-full overflow-hidden ring-1 ring-white/10">
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-app-accent/20 flex items-center justify-center">
              <Music size={20} className="text-app-accent" />
            </div>
          )}
        </div>
        {/* Spindle */}
        <div className="absolute inset-[48%] bg-[#111] rounded-full ring-1 ring-white/10" />
      </div>

      {/* Tonearm */}
      <div
        className="absolute right-4 top-4 origin-top-right"
        style={{ transform: `rotate(${isPlaying ? 28 : 20}deg)`, transition: 'transform 1s ease' }}
      >
        <div className="w-1 bg-gradient-to-b from-zinc-400 to-zinc-600 rounded-full" style={{ height: 90 }} />
        <div className="w-4 h-1 bg-zinc-500 rounded-full mt-0.5 -translate-x-3" />
      </div>
    </div>
  )
}

// ── Waveform ──────────────────────────────────────────────────────────────────

function Waveform({
  pct, isPlaying, songKey, onSeek,
}: {
  pct: number; isPlaying: boolean; songKey: string; onSeek: (pct: number) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)

  // Generate deterministic bar heights from the song key string
  const heights = useMemo(() => {
    const seed = songKey.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    return Array.from({ length: 80 }, (_, i) => {
      const x = Math.sin((i + seed) * 0.7) * 0.5 + Math.sin((i + seed) * 1.3) * 0.3 + 0.4
      return Math.max(0.1, Math.min(1, Math.abs(x)))
    })
  }, [songKey])

  const handleClick = (e: React.MouseEvent) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  return (
    <div
      ref={barRef}
      onClick={handleClick}
      className="flex items-center gap-[2px] h-14 cursor-pointer group"
    >
      {heights.map((h, i) => {
        const played = i / heights.length < pct / 100
        return (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-full transition-colors duration-300',
              played ? 'bg-app-accent' : 'bg-app-border group-hover:bg-app-muted/30',
            )}
            style={{
              height: `${h * 100}%`,
              opacity: isPlaying && played ? (0.7 + Math.sin(Date.now() / 200 + i) * 0.3) : 1,
            }}
          />
        )
      })}
    </div>
  )
}

// ── EQ Knob ───────────────────────────────────────────────────────────────────

function EqBand({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[10px] font-bold tracking-widest text-app-muted">{label}</span>
      <Slider.Root
        orientation="vertical"
        className="relative flex flex-col items-center select-none touch-none w-4"
        style={{ height: 100 }}
        min={-12} max={12} step={0.5}
        value={[value]}
        onValueChange={v => onChange(v[0])}
      >
        <Slider.Track className="bg-app-border relative grow rounded-full w-1">
          <Slider.Range className={cn(
            'absolute rounded-full w-full',
            value > 0 ? 'bg-app-accent' : 'bg-violet-400',
          )} />
        </Slider.Track>
        <Slider.Thumb
          className="block w-4 h-4 bg-white rounded-full shadow ring-2 ring-app-accent cursor-grab focus:outline-none"
        />
      </Slider.Root>
      <span className={cn(
        'text-[10px] tabular-nums font-mono',
        value > 0 ? 'text-app-accent' : value < 0 ? 'text-violet-400' : 'text-app-muted',
      )}>
        {value > 0 ? `+${value}` : value}
      </span>
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
  // Smooth position ticker
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songKey,  setSongKey]  = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!status?.nowPlaying) { if (tickRef.current) clearInterval(tickRef.current); return }
    const np      = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos  = status.position ?? 0
    if (np.url !== songKey) { setSongKey(np.url); setLocalPos(srvPos); setLocalLen(np.length); if (tickRef.current) clearInterval(tickRef.current) }
    else { setLocalLen(np.length); if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos) }
    if (playing && !tickRef.current) {
      tickRef.current = setInterval(() => setLocalPos(p => Math.min(p + 1, np.length)), 1000)
    } else if (!playing && tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Local EQ state (avoid re-seeking on every drag)
  const [eqLocal, setEqLocal] = useState({ bass: 0, mid: 0, treble: 0 })
  useEffect(() => {
    if (status?.eq) setEqLocal(status.eq)
  }, [status?.eq?.bass, status?.eq?.mid, status?.eq?.treble]) // eslint-disable-line react-hooks/exhaustive-deps

  // Volume
  const [volDragging, setVolDragging] = useState(false)
  const [volLocal,    setVolLocal]    = useState(100)
  useEffect(() => { if (!volDragging && status?.volume !== undefined) setVolLocal(status.volume) }, [status?.volume, volDragging])

  const isPlaying    = status?.status === 'PLAYING'
  const active       = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np           = status?.nowPlaying ?? null
  const currentSpeed = status?.speed  ?? 1
  const currentFx    = status?.effect ?? 'none'
  const pct          = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const handleSeek = useCallback(async (fraction: number) => {
    const pos = Math.round(fraction * localLen)
    setLocalPos(pos)
    await seek(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [localLen, token, guildId, onRefresh])

  const handleSpeed = async (s: number) => { await setSpeed(token, guildId, s).catch(() => null); onRefresh() }
  const handleFx    = async (fx: AudioEffect) => { await setEffect(token, guildId, fx).catch(() => null); onRefresh() }

  const handleVolumeCommit = useCallback(async (v: number[]) => {
    setVolDragging(false)
    await setVolume(token, guildId, v[0]).catch(() => null)
    onRefresh()
  }, [token, guildId, onRefresh])

  const handleEqCommit = useCallback(async () => {
    await setEq(token, guildId, eqLocal.bass, eqLocal.mid, eqLocal.treble).catch(() => null)
    onRefresh()
  }, [token, guildId, eqLocal, onRefresh])

  return (
    <div className="min-h-screen bg-[#070710] flex flex-col">
      {/* Top info bar */}
      <div className="flex items-center gap-4 px-8 py-4 border-b border-app-border/50">
        {np?.source && <SourceBadge source={np.source} />}
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-lg truncate">{np?.title ?? 'Nothing playing'}</p>
          <p className="text-app-muted text-sm truncate">{np?.artist ?? '—'}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-app-muted font-mono">
          <span>{fmtTime(localPos)}</span>
          <span className="mx-1 opacity-40">/</span>
          <span>{fmtTime(localLen)}</span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr] gap-0 overflow-auto">

        {/* ── Left: Turntable ── */}
        <div className="flex flex-col items-center justify-center gap-6 p-8 border-r border-app-border/30">
          <Turntable thumbnailUrl={np?.thumbnailUrl ?? null} isPlaying={isPlaying} />

          {/* Transport controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePause}
              className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg',
                active ? 'bg-app-accent hover:bg-violet-500 text-white' : 'bg-app-panel text-app-muted hover:text-white',
              )}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button onClick={handleSkip} className="w-10 h-10 rounded-full bg-app-panel hover:bg-app-border flex items-center justify-center text-app-muted hover:text-white transition-all">
              <SkipForward size={16} />
            </button>
            <button onClick={handleStop} className="w-10 h-10 rounded-full bg-app-panel hover:bg-app-border flex items-center justify-center text-app-muted hover:text-white transition-all">
              <Square size={16} />
            </button>
          </div>
        </div>

        {/* ── Center: Waveform + EQ + Effects ── */}
        <div className="flex flex-col gap-6 p-8">
          {/* Waveform */}
          <div className="space-y-2">
            <Waveform pct={pct} isPlaying={isPlaying} songKey={songKey} onSeek={handleSeek} />
            <div className="flex justify-between text-[10px] text-app-muted font-mono">
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* EQ section */}
          <div className="card p-5">
            <p className="text-[10px] font-bold tracking-widest text-app-muted uppercase mb-4">Equalizer</p>
            <div className="flex items-end justify-around">
              {(['bass', 'mid', 'treble'] as const).map(band => (
                <EqBand
                  key={band}
                  label={band.toUpperCase()}
                  value={eqLocal[band]}
                  onChange={v => setEqLocal(prev => ({ ...prev, [band]: v }))}
                />
              ))}
            </div>
            <button
              onClick={handleEqCommit}
              className="mt-4 w-full text-xs py-1.5 rounded-lg bg-app-accent/10 hover:bg-app-accent/20 text-app-accent font-medium transition-colors"
            >
              Apply EQ
            </button>
          </div>

          {/* Effects grid */}
          <div className="card p-5">
            <p className="text-[10px] font-bold tracking-widest text-app-muted uppercase mb-3">FX Presets</p>
            <div className="grid grid-cols-4 gap-2">
              {EFFECTS.map(fx => (
                <button
                  key={fx.id}
                  onClick={() => handleFx(fx.id)}
                  className={cn(
                    'py-2 px-1 rounded-lg border text-[10px] font-bold tracking-wide transition-all',
                    currentFx === fx.id
                      ? 'bg-app-accent border-app-accent text-white shadow-glow'
                      : fx.color,
                  )}
                >
                  {fx.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Speed + Volume ── */}
        <div className="flex flex-col gap-6 p-8 border-l border-app-border/30">

          {/* Tempo */}
          <div className="card p-5">
            <p className="text-[10px] font-bold tracking-widest text-app-muted uppercase mb-4">Tempo</p>
            <div className="flex flex-col gap-2">
              {SPEED_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className={cn(
                    'flex items-center justify-between px-4 py-2 rounded-lg border text-sm font-mono font-medium transition-all',
                    currentSpeed === s
                      ? 'bg-app-accent border-app-accent text-white'
                      : 'bg-app-panel border-app-border text-app-muted hover:text-white hover:border-app-muted/50',
                  )}
                >
                  <span>{s}×</span>
                  {s === 0.75 && <span className="text-[10px] opacity-60">SLOW</span>}
                  {s === 1    && <span className="text-[10px] opacity-60">NORM</span>}
                  {s === 1.25 && <span className="text-[10px] opacity-60">FAST</span>}
                  {s === 1.5  && <span className="text-[10px] opacity-60">FASTER</span>}
                  {s === 2    && <span className="text-[10px] opacity-60">2×</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Volume */}
          <div className="card p-5 flex-1 flex flex-col">
            <p className="text-[10px] font-bold tracking-widest text-app-muted uppercase mb-4">Volume</p>
            <div className="flex-1 flex flex-col items-center justify-between">
              <span className="text-2xl font-bold text-app-text tabular-nums">{volLocal}</span>
              <Slider.Root
                orientation="vertical"
                className="relative flex flex-col items-center select-none touch-none w-4 flex-1 my-4"
                min={0} max={200} step={1}
                value={[volLocal]}
                onValueChange={v => { setVolDragging(true); setVolLocal(v[0]) }}
                onValueCommit={handleVolumeCommit}
              >
                <Slider.Track className="bg-app-border relative grow rounded-full w-2">
                  <Slider.Range className="absolute bg-app-accent rounded-full w-full" />
                </Slider.Track>
                <Slider.Thumb
                  className="block w-5 h-5 bg-white rounded-full shadow-lg ring-2 ring-app-accent cursor-grab focus:outline-none"
                />
              </Slider.Root>
              <Volume2 size={16} className="text-app-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
