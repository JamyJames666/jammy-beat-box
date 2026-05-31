import { useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Shuffle, GripVertical, X, Music, Trash2, ListMusic, ChevronsUp } from 'lucide-react'
import { shuffle, clearQueue, move, remove, type TrackInfo } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

// ── Single sortable row ───────────────────────────────────────────────────────

interface RowProps {
  id: string
  item: TrackInfo
  index: number
  onRemove: (i: number) => void
  onMoveToTop: (i: number) => void
}

function QueueRow({ id, item, index, onRemove, onMoveToTop }: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={{ ...style, background: isDragging ? '#26263d' : 'rgba(30,16,64,0.4)', borderColor: isDragging ? '#a855f7' : '#26263d' }}
      className={cn(
        'flex items-center gap-3 rounded-xl px-4 py-3.5',
        'border transition-all duration-150',
        isDragging ? 'opacity-40 z-10' : '',
      )}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e1640'; (e.currentTarget as HTMLElement).style.borderColor = '#7c3aed' }}
      onMouseLeave={e => { if (!isDragging) { (e.currentTarget as HTMLElement).style.background = 'rgba(30,16,64,0.4)'; (e.currentTarget as HTMLElement).style.borderColor = '#26263d' } }}
    >
      {/* Number */}
      <span className="text-xs tabular-nums w-6 text-right flex-shrink-0 font-mono font-bold"
        style={{ color: '#5a4a7a' }}>
        {index + 1}
      </span>

      {/* Drag handle */}
      <button
        className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none transition-colors"
        style={{ color: '#3d2d5a' }}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      {/* Thumbnail */}
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
          style={{ boxShadow: '0 2px 12px rgba(168,85,247,0.3)' }}
          onError={e => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            img.nextElementSibling?.removeAttribute('style')
          }}
        />
      ) : null}
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
        style={item.thumbnailUrl ? { display: 'none' } : { background: 'linear-gradient(135deg,#2a1060,#1e1040)' }}
      >
        <Music size={20} style={{ color: '#7c3aed' }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold truncate leading-snug" style={{ color: '#f0f0ff' }} title={item.title}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm truncate" style={{ color: '#9090c0' }}>{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>

      {/* Duration */}
      <span className="text-sm flex-shrink-0 tabular-nums font-mono font-medium"
        style={{ color: '#7070a0' }}>
        {fmtTime(item.length)}
      </span>

      {/* Skip to top — only show when not already first */}
      {index > 0 && (
        <button
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
          style={{ color: '#5a4a7a', background: 'transparent' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,85,247,0.15)'; (e.currentTarget as HTMLElement).style.color = '#a855f7' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#5a4a7a' }}
          onClick={() => onMoveToTop(index)}
          aria-label="Play next"
          title="Play next"
        >
          <ChevronsUp size={15} />
        </button>
      )}

      {/* Remove */}
      <button
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all"
        style={{ color: '#5a4a7a', background: 'transparent' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(244,63,94,0.15)'; (e.currentTarget as HTMLElement).style.color = '#f43f5e' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#5a4a7a' }}
        onClick={() => onRemove(index)}
        aria-label="Remove from queue"
      >
        <X size={15} />
      </button>
    </li>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface Props {
  queue: TrackInfo[]
  token: string
  guildId: string
  onRefresh: () => void
  pendingCount?: number
  pendingPreview?: Array<{ title: string; artist: string }>
}

export default function QueueCard({ queue, token, guildId, onRefresh, pendingCount = 0, pendingPreview = [] }: Props) {
  // Optimistic local order to prevent flicker during DnD
  const [optimisticQueue, setOptimisticQueue] = useState<TrackInfo[] | null>(null)
  const displayQueue = optimisticQueue ?? queue

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = displayQueue.findIndex((_, i) => String(i) === active.id)
    const newIndex = displayQueue.findIndex((_, i) => String(i) === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    // Optimistic update
    setOptimisticQueue(arrayMove(displayQueue, oldIndex, newIndex))

    try {
      // API uses 1-based offsets relative to current (current = position 0)
      await move(token, guildId, oldIndex + 1, newIndex + 1)
    } catch {
      setOptimisticQueue(null)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }, [displayQueue, token, guildId, onRefresh])

  const handleShuffle = async () => {
    await shuffle(token, guildId).catch(() => null)
    onRefresh()
  }

  const handleClearQueue = async () => {
    await clearQueue(token, guildId).catch(() => null)
    onRefresh()
  }

  const handleRemove = async (index: number) => {
    // Optimistic remove
    setOptimisticQueue(displayQueue.filter((_, i) => i !== index))
    try {
      await remove(token, guildId, index + 1)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }

  const handleMoveToTop = async (index: number) => {
    // Optimistic reorder
    const next = [...displayQueue]
    const [song] = next.splice(index, 1)
    next.unshift(song)
    setOptimisticQueue(next)
    try {
      await move(token, guildId, index + 1, 1)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }

  return (
    <div className="card p-6 flex flex-col gap-5 min-h-[300px]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ListMusic size={15} className="flex-shrink-0" style={{ color: '#a855f7' }} />
        <h2 className="text-xs font-semibold uppercase tracking-widest mr-auto" style={{ background: 'linear-gradient(90deg,#a855f7,#6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          Queue
        </h2>
        {displayQueue.length > 0 && (
          <span className="text-xs text-app-muted bg-app-panel px-2.5 py-1 rounded-full
                           border border-app-border tabular-nums">
            {displayQueue.length} {displayQueue.length === 1 ? 'song' : 'songs'}
          </span>
        )}
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5"
          onClick={handleShuffle}
          disabled={displayQueue.length < 2}
        >
          <Shuffle size={13} /> Shuffle
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5
                     text-app-danger hover:text-app-danger hover:bg-app-danger/10"
          onClick={handleClearQueue}
          disabled={displayQueue.length === 0}
          title="Clear queue — bot stays connected"
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>

      {displayQueue.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-12 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-app-panel flex items-center justify-center">
            <Music size={22} className="text-app-muted" />
          </div>
          <p className="text-sm text-app-muted">Queue is empty</p>
          <p className="text-xs text-app-border">Add songs to get started</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={displayQueue.map((_, i) => String(i))}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5 overflow-y-auto -mx-1 px-1 py-0.5"
                style={{ maxHeight: 'calc(100vh - 280px)', minHeight: '200px' }}>
              {displayQueue.map((item, i) => (
                <QueueRow
                  key={`${item.url}-${i}`}
                  id={String(i)}
                  item={item}
                  index={i}
                  onRemove={handleRemove}
                  onMoveToTop={handleMoveToTop}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Pending songs — loaded lazily as the queue plays */}
      {pendingCount > 0 && (
        <div className="border-t border-app-border/50 pt-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-app-muted uppercase tracking-widest px-1">
            {pendingCount} more song{pendingCount !== 1 ? 's' : ''} loading as queue plays
          </p>
          {pendingPreview.map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-lg opacity-50">
              <Music size={10} className="text-app-border flex-shrink-0" />
              <p className="text-xs text-app-muted truncate">
                {s.title}
                {s.artist ? <span className="text-app-border"> · {s.artist}</span> : null}
              </p>
            </div>
          ))}
          {pendingCount > pendingPreview.length && (
            <p className="text-[10px] text-app-border px-2">
              +{pendingCount - pendingPreview.length} more…
            </p>
          )}
        </div>
      )}
    </div>
  )
}
