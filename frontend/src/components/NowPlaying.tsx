import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music } from 'lucide-react'
import { pause, resume, skip, stop, setSpeed, type PlayerStatus } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
}

export default function NowPlaying({ status, token, guildId, onRefresh }: Props) {
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songUrl,  setSongUrl]  = useState('')
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }
    const np = status.nowPlaying; const playing = status.status === 'PLAYING'; const srvPos = status.position ?? 0
    if (np.url !== songUrl) { setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick() }
    else { setLocalLen(np.length); if (Math.abs(localPos - srvPos) > 3) setLocalPos(srvPos) }
    if (playing && !tickRef.current) {
      const rate = status.speed ?? 1
      tickRef.current = setInterval(() => setLocalPos(p => Math.min(p + rate, np.length)), 1000)
    } else if (!playing) { stopTick() }
    return stopTick
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPlaying    = status?.status === 'PLAYING'
  const active       = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np           = status?.nowPlaying ?? null
  const currentSpeed = status?.speed ?? 1
  const pct          = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }
  const handleSpeed = async (s: number) => { await setSpeed(token, guildId, s).catch(() => null); onRefresh() }

  const progressRef = useRef<HTMLDivElement>(null)
  const handleSeek  = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || localLen === 0) return
    const r = progressRef.current?.getBoundingClientRect(); if (!r) return
    const pos = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * localLen)
    setLocalPos(pos)
    const {seek: seekFn} = await import('@/lib/api')
    await seekFn(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [active, localLen, token, guildId, onRefresh])

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl"
      style={{ background: 'linear-gradient(135deg, #200e14 0%, #0f0508 50%, #1a0810 100%)', border: '1px solid #4a1a28' }}>

      {!active ? (
        <div className="p-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f97316 0%, #f43f5e 100%)' }}>
            <Music size={24} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-lg">Nothing playing</p>
            <p className="text-sm mt-0.5" style={{ color: '#f08090' }}>Add a song to get started</p>
          </div>
        </div>
      ) : (
        <>
          {/* Album art + info */}
          <div className="flex gap-4 p-5 pb-3">
            <div className="relative flex-shrink-0">
              {np?.thumbnailUrl ? (
                <img src={np.thumbnailUrl} alt={np.title}
                  className="w-24 h-24 rounded-xl object-cover"
                  style={{ boxShadow: '0 0 24px rgba(244,63,94,0.5)' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div className="w-24 h-24 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}>
                  <Music size={28} className="text-white" />
                </div>
              )}
              <div className={cn('absolute bottom-2 right-2 flex items-end gap-[2px] h-4', !isPlaying && 'opacity-0')}>
                <span className="block w-[3px] rounded-sm animate-bar"   style={{ background: '#f97316' }} />
                <span className="block w-[3px] rounded-sm animate-bar-2" style={{ background: '#f43f5e' }} />
                <span className="block w-[3px] rounded-sm animate-bar-3" style={{ background: '#ec4899' }} />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-base leading-snug truncate" title={np?.title}>
                {np?.title ?? '—'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm truncate" style={{ color: '#f08090' }}>{np?.artist ?? '—'}</p>
                {np?.source && <SourceBadge source={np.source} />}
              </div>

              <div className="mt-3 space-y-1.5">
                <div ref={progressRef} onClick={handleSeek}
                  className={cn('relative h-1.5 rounded-full overflow-hidden', active && 'cursor-pointer')}
                  style={{ background: '#2a0e18' }}>
                  <div className="h-full rounded-full transition-[width] duration-1000"
                    style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #f97316, #ec4899)' }} />
                </div>
                <div className="flex justify-between text-[11px]" style={{ color: '#c07080' }}>
                  <span>{fmtTime(localPos)}</span>
                  <span>{fmtTime(localLen)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-5" style={{ height: 1, background: 'linear-gradient(90deg, transparent, #5c1e30, transparent)' }} />

          {/* Controls + speed */}
          <div className="flex items-center gap-2 px-5 py-3 flex-wrap">
            <button onClick={handlePause}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: isPlaying ? 'linear-gradient(135deg,#f97316,#f43f5e)' : '#200e14', color: 'white' }}>
              {isPlaying ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
            </button>

            <button onClick={handleSkip}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
              style={{ background: '#200e14', color: '#f08090' }}>
              <SkipForward size={14} /> Skip
            </button>

            <button onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
              style={{ background: '#200e14', color: '#c07080' }}>
              <Square size={14} /> Stop
            </button>

            <div className="flex items-center gap-0.5 ml-auto rounded-xl p-1" style={{ background: '#200e14' }}>
              {SPEED_OPTIONS.map(s => (
                <button key={s} onClick={() => handleSpeed(s)}
                  className="px-2 py-1 rounded-lg text-xs font-mono font-bold transition-all"
                  style={currentSpeed === s
                    ? { background: 'linear-gradient(135deg,#f97316,#f43f5e)', color: 'white' }
                    : { color: '#c07080' }}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
