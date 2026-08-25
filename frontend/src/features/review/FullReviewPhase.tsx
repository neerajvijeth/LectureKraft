import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Film, RotateCcw } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Button, Note, ProgressBar, Stat } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/Switch'
import { PipelinePicker } from '../upload/PipelinePicker'
import { RenderErrorBanner, useFinalizeRender, useStartOver } from './shared'
import { SlideCard } from './SlideCard'

export function FullReviewPhase({ session }: { session: SessionState }) {
  const qc = useQueryClient()
  const sid = session.session_id
  const slides = session.slides ?? []
  const meta = session.structure_metadata
  const { finalize, finalizing, error } = useFinalizeRender(sid, 'full')
  const startOver = useStartOver(sid)

  const [prefetchJob, setPrefetchJob] = useState<string | null>(null)
  const job = useJob(prefetchJob, {
    onDone: () => { setPrefetchJob(null); qc.invalidateQueries({ queryKey: ['session', sid] }) },
    onError: () => setPrefetchJob(null),
  })

  useEffect(() => {
    if (!session.images_prefetched && !prefetchJob && slides.length > 0) {
      api.full.prefetchImages(sid).then(({ job_id }) => setPrefetchJob(job_id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.images_prefetched, slides.length])

  const modified = slides.filter((s) => s.status !== 'original').length
  const images = slides.filter((s) => s.has_preview_image || s.has_custom_image).length

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker locked /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={1} /></SidebarGroup>
        <SidebarGroup title="Options">
          <Switch
            checked={session.skip_diagrams}
            onCheckedChange={async (v) => {
              const r = await api.full.updateSettings(sid, { skip_diagrams: v })
              qc.setQueryData(['session', sid], { ...session, skip_diagrams: r.skip_diagrams })
            }}
            label="Skip Manim" hint="Faster render, static diagrams"
          />
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <Button variant="primary" onClick={finalize} loading={finalizing}>
            <Film className="size-4" />Render video
          </Button>
          <Button variant="ghost" size="sm" onClick={startOver}>
            <RotateCcw className="size-3.5" />Start over
          </Button>
        </SidebarGroup>
      </Sidebar>
    }>
      <PageHeader
        eyebrow="Review"
        title="Every slide, before it renders."
        meta={session.topic || undefined}
        actions={<Button variant="primary" onClick={finalize} loading={finalizing}><Film className="size-4" />Render video</Button>}
      />

      <RenderErrorBanner error={session.render_error} traceback={session.render_traceback} />

      <div className="mb-8 flex gap-10 border-y border-ink-800 py-5">
        <Stat value={slides.length} label="Slides" />
        <Stat value={`${meta?.estimated_duration_minutes ?? '—'}m`} label="Est. length" />
        <Stat value={modified} label="Modified" tone={modified > 0 ? 'accent' : 'default'} />
        <Stat value={images} label="Images" />
      </div>

      {prefetchJob && (
        <div className="mb-6">
          <p className="mb-2 text-[12px] text-fog-500">{job.message || 'Fetching slide images…'}</p>
          <ProgressBar value={job.progress} />
        </div>
      )}

      {error && <Note className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="flex flex-col gap-2.5">
        {slides.map((s, i) => <SlideCard key={i} sessionId={sid} index={i} slide={s} />)}
      </div>

      <div className="mt-10 border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={finalize} loading={finalizing}>
          <Film className="size-4" />Render video
        </Button>
      </div>
    </Workspace>
  )
}
