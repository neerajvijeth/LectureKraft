import { cn } from '@/lib/utils'

/** Mark + wordmark. The mark is a simple aperture/play glyph rather than the
 *  raster logo, which doesn't hold up small or on dark. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-7', className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" className="fill-ink-800 stroke-ink-700" strokeWidth="1.5" />
      <path d="M13 11.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1l-7.3-4.8a.6.6 0 0 0-.92.5Z" className="fill-amber-400" />
      <circle cx="10" cy="16" r="1.6" className="fill-violet-400" />
    </svg>
  )
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <Mark />
      {!compact && (
        <span className="display text-[19px] tracking-tight text-fog-50">
          Lecture<span className="text-fog-500">Kraft</span>
        </span>
      )}
    </span>
  )
}
