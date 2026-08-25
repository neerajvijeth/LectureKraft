import { Film, RotateCcw } from 'lucide-react'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Button, Note, Stat } from '@/components/ui/primitives'
import { estimateDuration } from '@/lib/utils'
import { PipelinePicker } from '../upload/PipelinePicker'
import { RenderErrorBanner, useFinalizeRender, useStartOver } from './shared'
import { VoiceoverCard } from './VoiceoverCard'

export function SlidesReviewPhase({ session }: { session: SessionState }) {
  const sid = session.session_id
  const slides = session.slides_pipeline ?? []
  const { finalize, finalizing, error } = useFinalizeRender(sid, 'slides')
  const startOver = useStartOver(sid)

  const totalSeconds = slides.reduce((s, x) => s + estimateDuration(x.voiceover), 0)

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker locked /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={1} /></SidebarGroup>
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
        title="Narration, slide by slide."
        meta={session.slides_pptx_filename ? `${session.slides_pptx_filename} · slides unchanged` : undefined}
        actions={<Button variant="primary" onClick={finalize} loading={finalizing}><Film className="size-4" />Render video</Button>}
      />

      <RenderErrorBanner error={session.render_error} traceback={session.render_traceback} />

      <div className="mb-6 flex gap-10 border-y border-ink-800 py-5">
        <Stat value={slides.length} label="Slides" />
        <Stat value={`${Math.max(1, Math.round(totalSeconds / 60))}m`} label="Est. length" />
      </div>

      <Note className="mb-6">
        Word count drives how long each slide stays on screen — roughly 2.4 words a second.
        Your original deck is never modified.
      </Note>

      {error && <Note className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="flex flex-col gap-2">
        {slides.map((s, i) => <VoiceoverCard key={i} sessionId={sid} index={i} slide={s} />)}
      </div>

      <div className="mt-10 border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={finalize} loading={finalizing}>
          <Film className="size-4" />Render video
        </Button>
      </div>
    </Workspace>
  )
}
