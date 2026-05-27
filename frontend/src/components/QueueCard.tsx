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
import { Shuffle, GripVertical, X, Music, Trash2 } from 'lucide-react'
import { shuffle, clearQueue, move, remove, type TrackInfo } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

// ── Single sortable row ───────────────────────────────────────────────────────

interface RowProps {
  id: string
  item: TrackInfo
  index: number
  onRemove: (i: number) => void
}

function QueueRow({ id, item, index, onRemove }: RowProps) {
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
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5',
        'bg-app-panel border border-transparent',
        'hover:border-app-border hover:bg-app-panel/80 transition-all',
        isDragging && 'opacity-40 shadow-glow z-10',
      )}
    >
      {/* Drag handle */}
      <button
        className="text-app-border hover:text-app-muted transition-colors flex-shrink-0
                   cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>

      {/* Thumbnail */}
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          className="w-9 h-9 rounded-lg object-cover flex-shrink-0 bg-app-border"
          onError={e => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            img.nextElementSibling?.removeAttribute('style')
          }}
        />
      ) : null}
      <div
        className="w-9 h-9 rounded-lg bg-app-border flex items-center justify-center
                   flex-shrink-0 text-app-muted"
        style={item.thumbnailUrl ? { display: 'none' } : {}}
      >
        <Music size={12} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-app-text truncate leading-snug" title={item.title}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-xs text-app-muted truncate">{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>

      {/* Duration */}
      <span className="text-xs text-app-muted flex-shrink-0 tabular-nums">
        {fmtTime(item.length)}
      </span>

      {/* Remove */}
      <button
        className="btn-danger flex-shrink-0"
        onClick={() => onRemove(index)}
        aria-label="Remove from queue"
      >
        <X size={13} />
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
}

export default function QueueCard({ queue, token, guildId, onRefresh }: Props) {
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

  return (
    <div className="card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest mr-auto">
          Queue
        </h2>
        {displayQueue.length > 0 && (
          <span className="text-xs text-app-muted bg-app-panel px-2 py-0.5 rounded-full
                           border border-app-border">
            {displayQueue.length} {displayQueue.length === 1 ? 'song' : 'songs'}
          </span>
        )}
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
          onClick={handleShuffle}
          disabled={displayQueue.length < 2}
        >
          <Shuffle size={13} /> Shuffle
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5
                     text-app-danger hover:text-app-danger hover:bg-app-danger/10"
          onClick={handleClearQueue}
          disabled={displayQueue.length === 0}
          title="Clear queue — bot stays connected"
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>

      {displayQueue.length === 0 ? (
        <p className="text-sm text-app-muted py-2">Queue is empty.</p>
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
            <ul className="space-y-1 max-h-[480px] overflow-y-auto -mx-1 px-1 py-0.5">
              {displayQueue.map((item, i) => (
                <QueueRow
                  key={`${item.url}-${i}`}
                  id={String(i)}
                  item={item}
                  index={i}
                  onRemove={handleRemove}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
