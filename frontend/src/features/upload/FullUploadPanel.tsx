import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Button, Field, Input, Note } from '@/components/ui/primitives'
import { RangeSlider } from '@/components/ui/Slider'
import { Switch } from '@/components/ui/Switch'
import { FileDropzone } from '@/components/ui/FileDropzone'
import { PipelinePicker } from './PipelinePicker'
import { FormSection, GeneratingScreen } from './shared'

export function FullUploadPanel({ session }: { session: SessionState }) {
  const sid = session.session_id
  const qc = useQueryClient()

  const [topic, setTopic] = useState('')
  const [course, setCourse] = useState('')
  const [notes, setNotes] = useState<File[]>([])
  const [transcript, setTranscript] = useState<File[]>([])
  const [deck, setDeck] = useState<File[]>([])
  const [minutes, setMinutes] = useState(15)
  const [skipDiagrams, setSkipDiagrams] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const job = useJob(jobId, {
    onDone: () => qc.invalidateQueries({ queryKey: ['session', sid] }),
    onError: (e) => { setError(e); setJobId(null); setBusy(false) },
  })

  const total = notes.length + transcript.length + deck.length

  async function generate() {
    if (!topic.trim() && total === 0) {
      setError('Enter a topic or upload at least one file.')
      return
    }
    setError(null); setBusy(true)
    try {
      await Promise.all([
        notes.length ? api.uploadReference(sid, 'notes', notes, course) : null,
        transcript.length ? api.uploadReference(sid, 'transcript', transcript, course) : null,
        deck.length ? api.uploadReference(sid, 'slides', deck, course) : null,
      ])
      const { job_id } = await api.full.generateStructure(sid, {
        topic, target_duration_minutes: minutes, skip_diagrams: skipDiagrams,
      })
      setJobId(job_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation')
      setBusy(false)
    }
  }

  if (jobId) {
    return <GeneratingScreen job={job} title={<>Drafting your lecture{topic && <> on <em className="text-amber-400">{topic}</em></>}</>} />
  }

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={0} /></SidebarGroup>
      </Sidebar>
    }>
      <PageHeader
        eyebrow="Full AI Generation"
        title="What should this lecture cover?"
        meta="Notes are the primary source — the AI draws all depth and definitions from them."
      />

      <FormSection title="Topic" description="Optional. Leave blank and it will be inferred from your uploads.">
        <Input placeholder="e.g. Robustness in Deep Learning" value={topic} onChange={(e) => setTopic(e.target.value)} />
      </FormSection>

      <FormSection
        title="Source material"
        description="Indexed once and reused by later lectures. At least one file, or a topic above."
      >
        <Field
          label="Course tag (optional)"
          hint="Scopes retrieval so an ML textbook never leaks into a thermodynamics lecture."
        >
          <Input placeholder="e.g. ml-2024" value={course}
                 onChange={(e) => setCourse(e.target.value)} className="max-w-64" />
        </Field>
        <FileDropzone
          label="Notes / textbook"
          hint="Primary source. All content depth, definitions and explanations come from here."
          accept=".pdf,.docx,.txt,.md" files={notes} onChange={setNotes}
        />
        <FileDropzone
          label="Class transcript"
          hint="Identifies must-cover topics and lets narration echo the teacher's phrasing."
          accept=".pdf,.docx,.txt,.md" files={transcript} onChange={setTranscript}
        />
        <FileDropzone
          label="Slide deck"
          hint="Provides topic headers and the structural ordering of the video."
          accept=".pdf,.pptx,.docx,.txt" files={deck} onChange={setDeck}
        />
      </FormSection>

      <FormSection title="Output">
        <Field label={`Target duration — ${minutes} minutes`} hint="The AI decides how many slides best fill this length.">
          <RangeSlider value={minutes} onValueChange={setMinutes} min={5} max={30} />
        </Field>
        <Switch
          checked={skipDiagrams} onCheckedChange={setSkipDiagrams}
          label="Skip Manim animations"
          hint="Much faster render. Diagram slides fall back to static layouts."
        />
      </FormSection>

      {error && <Note icon={<AlertCircle className="size-4" />} className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="flex items-center gap-4 border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={generate} loading={busy}>
          Generate structure <ArrowRight className="size-4" />
        </Button>
        <span className="text-[12px] text-fog-600">
          {total > 0 ? `${total} file${total > 1 ? 's' : ''} ready` : 'No files attached'}
        </span>
      </div>
    </Workspace>
  )
}
