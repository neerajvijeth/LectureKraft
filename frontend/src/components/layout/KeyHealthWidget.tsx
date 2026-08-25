import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function KeyHealthWidget() {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['key-health'], queryFn: api.getKeyHealth,
    refetchInterval: 5000, retry: false,
  })

  if (!data) {
    return <p className="px-1 text-[11px] text-fog-600">Key status unavailable</p>
  }

  const none = data.keys_configured === 0
  const allDown = !none && data.keys_active === 0
  const dot = none ? 'bg-fog-600' : allDown ? 'bg-danger' : data.keys_cooling_down > 0 ? 'bg-warn' : 'bg-ok'
  const pct = data.tokens_today_limit > 0 ? Math.min(100, (data.tokens_today / data.tokens_today_limit) * 100) : 0

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xs px-1 py-1 text-left transition-colors hover:bg-ink-850"
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', dot, !none && !allDown && 'animate-breathe')} />
        <span className="flex-1 text-[11px] font-medium text-fog-400">
          {none ? 'No API keys set' : `${data.keys_active}/${data.keys_configured} keys active`}
        </span>
        <ChevronDown className={cn('size-3 text-fog-600 transition-transform', open && 'rotate-180')} />
      </button>

      {!none && (
        <div className="mt-2 px-1">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink-800">
            <div className="h-full rounded-full bg-amber-400/70" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[10px] text-fog-600">
            {compact(data.tokens_today)} / {compact(data.tokens_today_limit)} tokens today
          </p>
        </div>
      )}

      {open && (
        <div className="mt-2.5 flex flex-col gap-1.5 border-t border-ink-800 px-1 pt-2.5">
          <p className="text-[10px] text-fog-600">{data.model}</p>
          {data.keys.map((k) => (
            <div key={k.label} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-1.5 text-fog-500">
                <span className={cn('size-1 rounded-full', k.cooling_down ? 'bg-warn' : 'bg-ok')} />
                ···{k.key_suffix}
              </span>
              <span className="text-fog-600">
                {k.cooling_down ? `cooling ${Math.ceil(k.cooldown_remaining)}s` : `${k.tpm_used}/${k.tpm_limit} tpm`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
