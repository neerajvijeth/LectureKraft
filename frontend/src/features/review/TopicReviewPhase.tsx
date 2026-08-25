import { useMemo } from 'react'
import { Film, RotateCcw } from 'lucide-react'
import type { Scene, SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Badge, Button, Note, Stat } from '@/components/ui/primitives'
import { PipelinePicker } from '../upload/PipelinePicker'
import { RenderErrorBanner, useFinalizeRender, useStartOver } from './shared'
import { SceneCard } from './SceneCard'

const EMPTY: Scene[] = []

export function TopicReviewPhase({ session }: { session: SessionState }) {
  const sid = session.session_id
  const scenes = session.topic_scenes ?? EMPTY
  const meta = session.topic_structure_meta
  const { finalize, finalizing, error } = useFinalizeRender(sid, 'topic')
  const startOver = useStartOver(sid)

  const totalDur = scenes.reduce((s, x) => s + x.duration_seconds, 0)
  const modified = scenes.filter((s) => s.status !== 'original').length

  const types = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of scenes) c[s.scene_type] = (c[s.scene_type] ?? 0) + 1
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [scenes])

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
        title="The scene plan."
        meta={session.topic_topic}
        actions={<Button variant="primary" onClick={finalize} loading={finalizing}><Film className="size-4" />Render video</Button>}
      />

      <RenderErrorBanner error={session.render_error} traceback={session.render_traceback} />

      {meta?.description && <Note className="mb-6">{meta.description}</Note>}

      <div className="mb-6 flex gap-10 border-y border-ink-800 py-5">
        <Stat value={scenes.length} label="Scenes" />
        <Stat value={`${Math.max(1, Math.round(totalDur / 60))}m`} label="Est. length" />
        <Stat value={modified} label="Modified" tone={modified > 0 ? 'accent' : 'default'} />
      </div>

      {types.length > 0 && (
        <div className="mb-7 flex flex-wrap gap-1.5">
          {types.map(([t, n]) => <Badge key={t} tone="muted">{t}{n > 1 && ` ×${n}`}</Badge>)}
        </div>
      )}

      {error && <Note className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="flex flex-col gap-2.5">
        {scenes.map((s, i) => <SceneCard key={i} sessionId={sid} index={i} scene={s} />)}
      </div>

      <div className="mt-10 border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={finalize} loading={finalizing}>
          <Film className="size-4" />Render video
        </Button>
      </div>
    </Workspace>
  )
}
