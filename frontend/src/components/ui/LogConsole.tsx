import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export function LogConsole({ lines, className, maxLines = 200 }: {
  lines: string[]; className?: string; maxLines?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines.length])

  const visible = lines.slice(-maxLines)

  return (
    <div
      ref={ref}
      className={cn(
        'scrollbar-thin max-h-[300px] overflow-y-auto rounded-md border border-ink-700 bg-ink-950 px-4 py-3',
        'font-mono text-[11px] leading-[1.75] text-fog-600',
        className,
      )}
    >
      {visible.length === 0
        ? <span className="text-ink-600">Waiting for output…</span>
        : visible.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">{line}</div>
          ))}
    </div>
  )
}
