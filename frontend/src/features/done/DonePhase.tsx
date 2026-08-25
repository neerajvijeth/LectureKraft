import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, FileJson, FileText, Sparkles } from 'lucide-react'
import { api } from '@/api/client'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Badge, Button, Stat } from '@/components/ui/primitives'
import { Expander } from '@/components/ui/Accordion'
import { PipelinePicker } from '../upload/PipelinePicker'
import { PIPELINE_META } from '../upload/PipelinePicker'
import { formatSeconds, truncate } from '@/lib/utils'

export function DonePhase({ session }: { session: SessionState }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const sid = session.session_id

  const { data } = useQuery({
    queryKey: ['result-meta', sid],
    queryFn: () => api.getResultMetadata(sid),
    enabled: session.metadata_available,
  })
  const meta = data?.metadata

  const name = truncate(
    (session.pipeline === 'full' ? session.topic
      : session.pipeline === 'topic' ? session.topic_topic
      : session.slides_pptx_filename) || 'lecture', 35,
  ).replace(/\s+/g, '_')

  const downloads = [
    session.output_ready && { kind: 'video' as const, label: 'Video (MP4)', file: `${name}.mp4`, icon: <Download className="size-4" /> },
    session.metadata_available && { kind: 'metadata' as const, label: 'Metadata (JSON)', file: 'lecture_metadata.json', icon: <FileJson className="size-4" /> },
    session.description_available && { kind: 'description' as const, label: 'Description (MD)', file: 'lecture_description.md', icon: <FileText className="size-4" /> },
  ].filter(Boolean) as { kind: 'video' | 'metadata' | 'description'; label: string; file: string; icon: React.ReactNode }[]

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker locked /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={3} /></SidebarGroup>
        <SidebarGroup className="mt-auto">
          <Button variant="secondary" onClick={async () => {
            const fresh = await api.backToReview(sid)
            qc.setQueryData(['session', sid], fresh)
          }}>
            <ArrowLeft className="size-4" />Back to review
          </Button>
          <Button variant="primary" onClick={() => navigate('/')}>
            <Sparkles className="size-4" />New lecture
          </Button>
        </SidebarGroup>
      </Sidebar>
    }>
      <PageHeader
        eyebrow="Complete"
        title={<>Your video is <em className="text-amber-400">ready</em>.</>}
        meta={PIPELINE_META[session.pipeline].label}
      />

      {session.output_ready && (
        <div className="mb-8 overflow-hidden rounded-lg border border-ink-700 bg-black">
          <video
            src={api.downloadUrl(sid, 'video')}
            controls
            className="aspect-video w-full"
          />
        </div>
      )}

      <div className="mb-9 flex gap-10 border-y border-ink-800 py-5">
        <Stat value={meta?.total_slides ?? '—'} label={session.pipeline === 'topic' ? 'Scenes' : 'Slides'} />
        <Stat value={meta ? `${meta.estimated_duration_minutes}m` : '—'} label="Length" />
        <Stat
          value={session.render_elapsed != null ? formatSeconds(session.render_elapsed) : '—'}
          label="Render time" tone="accent"
        />
        {meta?.target_audience && (
          <div className="flex flex-col justify-center">
            <Badge tone="muted">{meta.target_audience}</Badge>
          </div>
        )}
      </div>

      <h2 className="mb-3.5 text-[15px] font-semibold text-fog-100">Downloads</h2>
      <div className="mb-9 flex flex-wrap gap-2.5">
        {downloads.map((d) => (
          <a key={d.kind} href={api.downloadUrl(sid, d.kind)} download={d.file}>
            <Button variant="secondary">{d.icon}{d.label}</Button>
          </a>
        ))}
      </div>

      {meta?.full_description && (
        <Expander title="Video description" className="mb-8">
          <p className="whitespace-pre-wrap">{meta.full_description}</p>
        </Expander>
      )}

      <p className="border-t border-ink-800 pt-6 text-[13px] leading-relaxed text-fog-500">
        Want to change something? Go <strong className="font-medium text-fog-200">back to review</strong> and
        re-render — only what you touched gets reprocessed.
      </p>
    </Workspace>
  )
}
