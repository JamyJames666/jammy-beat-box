interface Props {
  source: 'youtube' | 'spotify' | string
  className?: string
}

export default function SourceBadge({ source, className }: Props) {
  if (source === 'spotify') {
    return <span className={`badge-sp ${className ?? ''}`}>Spotify</span>
  }
  return <span className={`badge-yt ${className ?? ''}`}>YouTube</span>
}
