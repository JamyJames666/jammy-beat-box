import { useState, useCallback } from 'react'
import {
  setCrossfade, setEffect, setSpeed, toggleLoopSong, toggleLoopQueue,
  shuffle, type PlayerStatus, type AudioEffect,
} from '@/lib/api'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Toggle — a big pill-style on/off switch with label + description
// ─────────────────────────────────────────────────────────────────────────────

interface ToggleProps {
  label: string
  description: string
  enabled: boolean
  onChange: () => void
  accent?: string
}

function Toggle({ label, description, enabled, onChange, accent = '#7c3aed' }: ToggleProps) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'flex items-center justify-between w-full px-4 py-3.5 rounded-xl border transition-all text-left',
        enabled ? 'border-transparent' : 'border-app-border bg-app-surface hover:border-app-muted/30',
      )}
      style={enabled ? { background: `${accent}18`, border: `1px solid ${accent}50` } : {}}
    >
      <div className="min-w-0 mr-4">
        <p className="text-sm font-semibold text-app-text">{label}</p>
        <p className="text-xs text-app-muted mt-0.5">{description}</p>
      </div>
      {/* Pill toggle */}
      <div
        className="relative flex-shrink-0 w-11 h-6 rounded-full transition-all duration-200"
        style={{ background: enabled ? accent : '#252535' }}
      >
        <div
          className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
          style={{ left: enabled ? 24 : 4 }}
        />
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-app-muted mb-2 px-1">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CrossfadeSlider — pick duration with visual presets
// ─────────────────────────────────────────────────────────────────────────────

const XFADE_OPTIONS = [
  { s: 0, label: 'OFF' },
  { s: 2, label: '2s' },
  { s: 4, label: '4s' },
  { s: 6, label: '6s' },
  { s: 8, label: '8s' },
]

function CrossfadeRow({ current, onChange }: { current: number; onChange: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl border border-app-border bg-app-surface">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-semibold text-app-text">Crossfade Duration</p>
        <p className="text-xs text-app-muted mt-0.5">Fade between songs automatically</p>
      </div>
      <div className="flex gap-1">
        {XFADE_OPTIONS.map(o => (
          <button
            key={o.s}
            onClick={() => onChange(o.s)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-bold transition-all border',
              current === o.s
                ? 'bg-app-accent border-app-accent text-white'
                : 'bg-app-panel border-app-border text-app-muted hover:text-white hover:border-app-muted/50',
            )}
          >{o.label}</button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SpeedRow
// ─────────────────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2]

function SpeedRow({ current, onChange }: { current: number; onChange: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl border border-app-border bg-app-surface">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-semibold text-app-text">Playback Speed</p>
        <p className="text-xs text-app-muted mt-0.5">Global playback rate for all songs</p>
      </div>
      <div className="flex gap-1">
        {SPEED_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all border',
              current === s
                ? 'bg-app-accent border-app-accent text-white'
                : 'bg-app-panel border-app-border text-app-muted hover:text-white hover:border-app-muted/50',
            )}
          >{s}×</button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EffectRow
// ─────────────────────────────────────────────────────────────────────────────

const EFFECT_OPTIONS: { id: AudioEffect; label: string; description: string }[] = [
  { id: 'none',      label: 'Off',       description: 'No audio processing'          },
  { id: 'bass',      label: 'Bass Boost',description: 'Deep sub-bass emphasis'       },
  { id: 'treble',    label: 'Treble',    description: 'Crisp high-frequency boost'   },
  { id: 'reverb',    label: 'Reverb',    description: 'Room echo effect'             },
  { id: '8d',        label: '8D Audio',  description: 'Rotating stereo panning'      },
  { id: 'nightcore', label: 'Nightcore', description: 'Pitch shifted up 25%'         },
  { id: 'vaporwave', label: 'Vaporwave', description: 'Pitch shifted down 20%'       },
]

function EffectGrid({ current, onChange }: { current: AudioEffect; onChange: (e: AudioEffect) => void }) {
  return (
    <div className="px-4 py-3.5 rounded-xl border border-app-border bg-app-surface space-y-3">
      <div>
        <p className="text-sm font-semibold text-app-text">Active Effect</p>
        <p className="text-xs text-app-muted mt-0.5">Applied to all playback in real-time</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {EFFECT_OPTIONS.map(fx => (
          <button
            key={fx.id}
            onClick={() => onChange(fx.id)}
            className={cn(
              'flex flex-col text-left px-3 py-2.5 rounded-lg border transition-all',
              current === fx.id
                ? 'bg-app-accent/15 border-app-accent text-app-accent'
                : 'bg-app-panel border-app-border text-app-muted hover:text-app-text hover:border-app-muted/30',
            )}
          >
            <span className="text-xs font-bold">{fx.label}</span>
            <span className="text-[10px] mt-0.5 opacity-70">{fx.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main AutoDj
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function AutoDj({ status, token, guildId, onRefresh }: Props) {
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await fn() } catch { /* best-effort */ } finally {
      setBusy(false)
      onRefresh()
    }
  }, [busy, onRefresh])

  const xfade    = status?.crossfade ?? 0
  const speed    = status?.speed     ?? 1
  const effect   = status?.effect    ?? 'none'
  const loopSong = status?.loopSong  ?? false
  const loopQ    = status?.loopQueue ?? false
  const isActive = status?.status === 'PLAYING' || status?.status === 'PAUSED'

  return (
    <div className="min-h-[calc(100vh-61px)] bg-app-bg">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-app-text">Auto DJ</h1>
          <p className="text-sm text-app-muted mt-1">
            Configure automatic transitions, effects, and playback behaviour.
            Changes take effect on the next song.
          </p>
          {isActive && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-green-900/20 border border-green-700/30 w-fit">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live — changes apply immediately</span>
            </div>
          )}
        </div>

        {/* Transitions */}
        <Section title="Transitions">
          <CrossfadeRow current={xfade} onChange={s => call(() => setCrossfade(token, guildId, s))} />
        </Section>

        {/* Playback */}
        <Section title="Playback">
          <SpeedRow current={speed} onChange={s => call(() => setSpeed(token, guildId, s))} />
          <Toggle
            label="Loop Current Song"
            description="Repeat the playing track indefinitely"
            enabled={loopSong}
            onChange={() => call(() => toggleLoopSong(token, guildId))}
            accent="#3b82f6"
          />
          <Toggle
            label="Loop Queue"
            description="Restart the queue from the beginning when it ends"
            enabled={loopQ}
            onChange={() => call(() => toggleLoopQueue(token, guildId))}
            accent="#22c55e"
          />
          <Toggle
            label="Shuffle Now"
            description="Randomise the current queue order instantly"
            enabled={false}
            onChange={() => call(() => shuffle(token, guildId))}
            accent="#f97316"
          />
        </Section>

        {/* Effects */}
        <Section title="Sound Effects">
          <EffectGrid current={effect} onChange={e => call(() => setEffect(token, guildId, e))} />
        </Section>

        {/* Info footer */}
        <p className="text-xs text-app-border text-center pb-4">
          EQ and crossfader fine-tuning are available in the PRO DJ deck
        </p>

      </div>
    </div>
  )
}
