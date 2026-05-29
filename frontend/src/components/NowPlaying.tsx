import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Volume2 } from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { pause, resume, skip, stop, setVolume, type PlayerStatus } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function NowPlaying({ status, token, guildId, onRefresh }: Props) {
  // ── Smooth local position counter ─────────────────────────────────────────
  const [localPos, setLocalPos]       = useState(0)
  const [localLen, setLocalLen]       = useState(0)
  const [songUrl,  setSongUrl]        = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }

    const np      = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos  = status.position ?? 0

    // Detect song change
    if (np.url !== songUrl) {
      setSongUrl(np.url)
      setLocalPos(srvPos)
      setLocalLen(np.length)
      stopTick()
    } else {
      setLocalLen(np.length)
      if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos)
    }

    if (playing && !tickRef.current) {
      tickRef.current = setInterval(() => {
        setLocalPos(p => Math.min(p + 1, np.length))
      }, 1000)
    } else if (!playing) {
      stopTick()
    }

    return stopTick
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Volume local state (avoid jumping while dragging) ────────────────────
  const [volDragging, setVolDragging] = useState(false)
  const [volLocal,    setVolLocal]    = useState(100)

  useEffect(() => {
    if (!volDragging && status?.volume !== undefined) setVolLocal(status.volume)
  }, [status?.volume, volDragging])

  const handleVolumeCommit = useCallback(async (v: number[]) => {
    setVolDragging(false)
    await setVolume(token, guildId, v[0]).catch(() => null)
    onRefresh()
  }, [token, guildId, onRefresh])

  // ── Controls ─────────────────────────────────────────────────────────────
  const isPlaying = status?.status === 'PLAYING'
  const active    = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np        = status?.nowPlaying ?? null

  const handlePause = async () => {
    await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null)
    onRefresh()
  }
  const handleSkip = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const pct = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  return (
    <div className="card p-6 space-y-5">
      <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest">
        Now Playing
      </h2>

      {!active ? (
        <div className="flex items-center gap-4 py-4">
          <div className="w-16 h-16 rounded-2xl bg-app-panel flex items-center justify-center flex-shrink-0">
            <Volume2 size={22} className="text-app-muted" />
          </div>
          <div>
            <p className="text-app-text font-medium">Nothing playing</p>
            <p className="text-app-muted text-sm mt-0.5">Add a song to get started</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-5">
            {/* Thumbnail */}
            <div className="relative flex-shrink-0">
              {np?.thumbnailUrl ? (
                <img
                  src={np.thumbnailUrl}
                  alt={np.title}
                  className="w-28 h-28 rounded-2xl object-cover shadow-card"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div className="w-28 h-28 rounded-2xl bg-app-panel
                                flex items-center justify-center">
                  <Volume2 size={28} className="text-app-muted" />
                </div>
              )}
              {/* Playing bars overlay */}
              <div className={cn(
                'absolute bottom-2.5 right-2.5 flex items-end gap-[3px] h-5',
                !isPlaying && 'opacity-0',
              )}>
                <span className="block w-1 bg-app-accent rounded-sm animate-bar" />
                <span className="block w-1 bg-app-accent rounded-sm animate-bar-2" />
                <span className="block w-1 bg-app-accent rounded-sm animate-bar-3" />
              </div>
            </div>

            {/* Song info */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="font-semibold text-app-text text-base leading-snug
                            truncate" title={np?.title}>
                {np?.title ?? '—'}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-app-muted truncate">{np?.artist ?? '—'}</p>
                {np?.source && <SourceBadge source={np.source} />}
              </div>

              {/* Progress */}
              <div className="pt-3 space-y-1.5">
                <div className="relative h-1.5 bg-app-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-app-accent rounded-full transition-[width] duration-1000"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-app-muted">
                  <span>{fmtTime(localPos)}</span>
                  <span>{fmtTime(localLen)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className={cn(
                'btn-secondary flex items-center gap-1.5 px-4 py-2 text-sm',
                isPlaying && 'border-app-accent/40 text-app-accent',
              )}
              onClick={handlePause}
            >
              {isPlaying
                ? <><Pause  size={15} /> Pause</>
                : <><Play   size={15} /> Resume</>}
            </button>

            <button className="btn-secondary flex items-center gap-1.5 px-4 py-2 text-sm"
                    onClick={handleSkip}>
              <SkipForward size={15} /> Skip
            </button>

            <button className="btn-ghost flex items-center gap-1.5 px-4 py-2 text-sm"
                    onClick={handleStop}>
              <Square size={15} /> Stop
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2.5 ml-auto">
              <Volume2 size={14} className="text-app-muted flex-shrink-0" />
              <Slider.Root
                className="relative flex items-center select-none touch-none w-28 h-5"
                min={0} max={200} step={1}
                value={[volLocal]}
                onValueChange={v => { setVolDragging(true); setVolLocal(v[0]) }}
                onValueCommit={handleVolumeCommit}
              >
                <Slider.Track className="bg-app-border relative grow rounded-full h-1.5">
                  <Slider.Range className="absolute bg-app-accent rounded-full h-full" />
                </Slider.Track>
                <Slider.Thumb
                  className="block w-3.5 h-3.5 bg-white rounded-full shadow
                             focus:outline-none focus:ring-2 focus:ring-app-accent cursor-grab"
                />
              </Slider.Root>
              <span className="text-xs text-app-muted w-8 text-right tabular-nums">{volLocal}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
