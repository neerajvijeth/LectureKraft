import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { SessionState } from '@/api/types'
import { PageHeader, PhaseStepper, Sidebar, SidebarGroup, Workspace } from '@/components/layout/AppShell'
import { Button, Field, Input, Note, Textarea } from '@/components/ui/primitives'
import { FileDropzone } from '@/components/ui/FileDropzone'
import { PipelinePicker } from './PipelinePicker'
import { FormSection, GeneratingScreen } from './shared'

export function SlidesUploadPanel({ session }: { session: SessionState }) {
  const sid = session.session_id
  const qc = useQueryClient()

  const [pptx, setPptx] = useState<File[]>([])
  const [context, setContext] = useState('')
  const [course, setCourse] = useState('')
  const [transcript, setTranscript] = useState<File[]>([])
  const [notes, setNotes] = useState<File[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const job = useJob(jobId, {
    onDone: () => qc.invalidateQueries({ queryKey: ['session', sid] }),
    onError: (e) => { setError(e); setJobId(null); setBusy(false) },
  })

  async function generate() {
    if (!pptx.length) { setError('Upload a PPTX file first.'); return }
    setError(null); setBusy(true)
    try {
      await api.uploadPptx(sid, pptx[0])
      await Promise.all([
        transcript.length ? api.uploadReference(sid, 'transcript', transcript, course) : null,
        notes.length ? api.uploadReference(sid, 'notes', notes, course) : null,
      ])
      const { job_id } = await api.slides.generateVoiceovers(sid, { context })
      setJobId(job_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation')
      setBusy(false)
    }
  }

  if (jobId) return <GeneratingScreen job={job} title="Writing narration for your slides" />

  return (
    <Workspace sidebar={
      <Sidebar>
        <SidebarGroup title="Pipeline"><PipelinePicker /></SidebarGroup>
        <SidebarGroup title="Progress"><PhaseStepper current={0} /></SidebarGroup>
      </Sidebar>
    }>
      <PageHeader
        eyebrow="Slides + Voiceover"
        title="Bring your own deck."
        meta="Your slides render exactly as you built them. Only narration is added."
      />

      <FormSection title="Presentation">
        <FileDropzone
          label="PPTX file" required
          hint="Used as-is — not a single element is moved or restyled."
          accept=".pptx" multiple={false} files={pptx} onChange={setPptx}
        />
      </FormSection>

      <FormSection title="Context" description="Optional, but it noticeably improves the narration.">
        <Textarea
          rows={3} value={context} onChange={(e) => setContext(e.target.value)}
          placeholder="e.g. This lecture covers gradient descent for a 2nd-year ML course."
        />
      </FormSection>

      <FormSection
        title="Reference sources"
        description="Optional. Indexed for retrieval, so narration cites your own material."
      >
        <Field
          label="Course tag (optional)"
          hint="Scopes retrieval to one subject."
        >
          <Input placeholder="e.g. ml-2024" value={course}
                 onChange={(e) => setCourse(e.target.value)} className="max-w-64" />
        </Field>
        <FileDropzone
          label="Class transcript" hint="Narration will echo the teacher's own phrasing."
          accept=".pdf,.docx,.txt,.md" files={transcript} onChange={setTranscript}
        />
        <FileDropzone
          label="Notes / textbook" hint="Adds depth and precise definitions."
          accept=".pdf,.docx,.txt,.md" files={notes} onChange={setNotes}
        />
      </FormSection>

      {error && <Note icon={<AlertCircle className="size-4" />} className="mb-5 border-danger/25 text-danger">{error}</Note>}

      <div className="flex items-center gap-4 border-t border-ink-800 pt-7">
        <Button variant="primary" size="lg" onClick={generate} loading={busy}>
          Generate voiceovers <ArrowRight className="size-4" />
        </Button>
        {pptx[0] && <span className="truncate text-[12px] text-fog-600">{pptx[0].name}</span>}
      </div>
    </Workspace>
  )
}
