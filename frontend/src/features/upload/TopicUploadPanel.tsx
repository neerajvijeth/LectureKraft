import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Button, Field, Input, Note, Textarea } from '@/components/ui/primitives'
import { RangeSlider } from '@/components/ui/Slider'
import { PipelinePicker } from './PipelinePicker'
import { FormSection, GeneratingScreen } from './shared'

export function TopicUploadPanel({ session }: { session: SessionState }) {
  const sid = session.session_id
  const qc = useQueryClient()

  const [topic, setTopic] = useState('')
  const [context, setContext] = useState('')
  const [minutes, setMinutes] = useState(7)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const job = useJob(jobId, {
    onDone: () => qc.invalidateQueries({ queryKey: ['session', sid] }),
    onError: (e) => { setError(e); setJobId(null); setBusy(false) },
  })

  async function generate() {
    if (!topic.trim()) { setError('Enter a topic first.'); return }
    setError(null); setBusy(true)
    try {
      const { job_id } = await api.topic.generateStructure(sid, { topic, context, target_minutes: minutes })
      setJobId(job_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation')
      setBusy(false)
    }
  }

  if (jobId) {
    return <GeneratingScreen job={job} title={<>Designing scenes for <em className="text-teal-400">{topic}</em></>} />
  }

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={0} /></SidebarGroup>
      </Sidebar>
    }>
      <PageHeader
        eyebrow="Topic Video"
        title="What should the video teach?"
        meta="Fully animated with Manim — no slides, no stock photography."
      />

      <FormSection title="Topic">
        <Input
          placeholder="e.g. Gradient Descent, Newton's Laws, LSTM Networks"
          value={topic} onChange={(e) => setTopic(e.target.value)}
        />
      </FormSection>

      <FormSection title="Context" description="Optional. Tells the AI who is watching and how deep to go.">
        <Textarea
          rows={3} value={context} onChange={(e) => setContext(e.target.value)}
          placeholder="e.g. 2nd-year undergrad ML course. Focus on intuition, include worked examples."
        />
      </FormSection>

      <FormSection title="Output">
        <Field label={`Target duration — ${minutes} minutes`} hint="Scenes are planned to fill roughly this length.">
          <RangeSlider value={minutes} onValueChange={setMinutes} min={3} max={12} />
        </Field>
      </FormSection>

      {error && <Note icon={<AlertCircle className="size-4" />} className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={generate} loading={busy}>
          Generate scene plan <ArrowRight className="size-4" />
        </Button>
      </div>
    </Workspace>
  )
}
