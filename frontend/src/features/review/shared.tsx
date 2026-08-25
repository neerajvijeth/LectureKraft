import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/api/client'
import type { Pipeline, SlideStatus } from '@/api/types'
import { useUIStore } from '@/store/session'
import { Expander } from '@/components/ui/Accordion'
import { Badge } from '@/components/ui/primitives'

const RENDER: Record<Pipeline, (sid: string) => Promise<{ job_id: string }>> = {
  full: (sid) => api.full.render(sid),
  slides: (sid) => api.slides.render(sid),
  topic: (sid) => api.topic.render(sid),
}

export function useFinalizeRender(sessionId: string, pipeline: Pipeline) {
  const qc = useQueryClient()
  const setActiveJobId = useUIStore((s) => s.setActiveJobId)
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finalize() {
    setFinalizing(true); setError(null)
    try {
      const { job_id } = await RENDER[pipeline](sessionId)
      setActiveJobId(job_id)
      await qc.invalidateQueries({ queryKey: ['session', sessionId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start render')
      setFinalizing(false)
    }
  }
  return { finalize, finalizing, error }
}

export function useStartOver(sessionId: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async function startOver() {
    const fresh = await api.startOver(sessionId)
    qc.setQueryData(['session', sessionId], fresh)
    navigate(`/s/${sessionId}`)
  }
}

/** Status badge. "original" renders nothing — the absence of a badge is the
 *  cleanest possible signal that a card is untouched. */
export function StatusBadge({ status }: { status: SlideStatus }) {
  if (status === 'edited') return <Badge tone="amber">Edited</Badge>
  if (status === 'regenerated') return <Badge tone="violet">Regenerated</Badge>
  return null
}

export const STATUS_EDGE: Record<SlideStatus, string> = {
  original: 'before:bg-transparent',
  edited: 'before:bg-amber-400',
  regenerated: 'before:bg-violet-400',
}

export function RenderErrorBanner({ error, traceback }: { error: string | null; traceback: string | null }) {
  if (!error) return null
  return (
    <div className="mb-7 rounded-md border border-danger/25 bg-danger/5 p-4">
      <p className="flex items-start gap-2 text-[13px] font-medium text-danger">
        <AlertTriangle className="mt-px size-4 shrink-0" />
        <span>Rendering failed — {error}</span>
      </p>
      {traceback && (
        <Expander title="Full traceback" className="mt-3">
          <pre className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fog-600">
            {traceback}
          </pre>
        </Expander>
      )}
    </div>
  )
}

/** Card shell shared by slide and scene cards. */
export function ReviewCard({ status, children, className }: {
  status: SlideStatus; children: React.ReactNode; className?: string
}) {
  return (
    <div className={[
      'group/card relative overflow-hidden rounded-md border border-ink-700 bg-ink-900 transition-colors',
      'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:transition-colors',
      'hover:border-ink-600',
      STATUS_EDGE[status], className ?? '',
    ].join(' ')}>
      {children}
    </div>
  )
}
