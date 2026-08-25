import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, Pencil, RotateCcw, Sparkles, Undo2, X } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { Slide } from '@/api/types'
import { useUIStore } from '@/store/session'
import { Badge, Button, Checkbox, Field, Input, ProgressBar, Select, Textarea } from '@/components/ui/primitives'
import { LogConsole } from '@/components/ui/LogConsole'
import { ImagePanel } from './ImagePanel'
import { ReviewCard, StatusBadge } from './shared'

export function SlideCard({ sessionId, index, slide }: { sessionId: string; index: number; slide: Slide }) {
  const qc = useQueryClient()
  const { slideCardMode, setSlideCardMode } = useUIStore()
  const mode = slideCardMode[index] ?? null
  const invalidate = () => qc.invalidateQueries({ queryKey: ['session', sessionId] })
  const close = () => setSlideCardMode(index, null)

  return (
    <ReviewCard status={slide.status}>
      <div className="p-5 pl-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 font-mono text-[11px] text-fog-600">{String(index + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-fog-50">{slide.title}</h3>
              <Badge tone={slide.type === 'diagram' ? 'violet' : 'muted'}>
                {slide.type === 'diagram' ? (slide.diagram && slide.diagram !== 'none' ? slide.diagram : 'diagram') : 'text'}
              </Badge>
              <StatusBadge status={slide.status} />
            </div>

            {mode === null && (slide.retrieved_from?.length ?? 0) > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-fog-600">
                <BookOpen className="mt-px size-3 shrink-0" />
                <span className="min-w-0 truncate" title={slide.retrieved_from!.join(' · ')}>
                  grounded in {slide.retrieved_from!.join(' · ')}
                </span>
              </p>
            )}

            {mode === null && slide.bullets.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-1">
                {slide.bullets.slice(0, 2).map((b, i) => (
                  <li key={i} className="truncate text-[13px] text-fog-500">— {b}</li>
                ))}
                {slide.bullets.length > 2 && (
                  <li className="text-[12px] text-fog-600">+{slide.bullets.length - 2} more</li>
                )}
              </ul>
            )}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-fog-600">{slide.slide_duration_seconds}s</span>
        </div>

        {mode === null && (
          <>
            {slide.type === 'text' && (
              <ImagePanel sessionId={sessionId} index={index} slide={slide} onUpdated={invalidate} />
            )}
            <div className="mt-4 flex gap-1.5 opacity-70 transition-opacity group-hover/card:opacity-100">
              <Button size="sm" variant="ghost" onClick={() => setSlideCardMode(index, 'edit')}>
                <Pencil className="size-3.5" />Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSlideCardMode(index, 'regen')}>
                <Sparkles className="size-3.5" />Regenerate
              </Button>
              {slide.status !== 'original' && (
                <Button size="sm" variant="ghost" onClick={async () => { await api.full.resetSlide(sessionId, index); close(); invalidate() }}>
                  <Undo2 className="size-3.5" />Reset
                </Button>
              )}
            </div>
          </>
        )}

        {mode === 'edit' && (
          <SlideEditor sessionId={sessionId} index={index} slide={slide}
            onDone={() => { close(); invalidate() }} onCancel={close} />
        )}
        {mode === 'regen' && (
          <RegenPanel sessionId={sessionId} index={index}
            onDone={() => { close(); invalidate() }} onCancel={close} />
        )}
      </div>
    </ReviewCard>
  )
}

function SlideEditor({ sessionId, index, slide, onDone, onCancel }: {
  sessionId: string; index: number; slide: Slide; onDone: () => void; onCancel: () => void
}) {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.getMeta, staleTime: Infinity })
  const [title, setTitle] = useState(slide.title)
  const [bullets, setBullets] = useState(slide.bullets.join('\n'))
  const [voiceover, setVoiceover] = useState(slide.voiceover)
  const [type, setType] = useState<'text' | 'diagram'>(slide.type)
  const [diagram, setDiagram] = useState(slide.diagram || 'none')
  const [imageNeeded, setImageNeeded] = useState(slide.image?.needed ?? false)
  const [queries, setQueries] = useState((slide.image?.search_queries ?? []).join('\n'))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api.full.editSlide(sessionId, index, {
        title,
        bullets: bullets.split('\n').map((b) => b.trim()).filter(Boolean),
        voiceover, type, diagram,
        image_needed: imageNeeded,
        image_queries: queries.split('\n').map((q) => q.trim()).filter(Boolean),
      })
      onDone()
    } finally { setSaving(false) }
  }

  return (
    <div className="mt-5 flex flex-col gap-5 border-t border-ink-800 pt-5">
      <Field label="Title" hint="Max 55 characters — longer titles get clipped in the rendered slide.">
        <Input value={title} maxLength={55} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Bullets" hint="One per line.">
          <Textarea rows={6} value={bullets} onChange={(e) => setBullets(e.target.value)} />
        </Field>
        <Field label="Narration" hint="120–200 words reads as roughly one minute.">
          <Textarea rows={6} value={voiceover} onChange={(e) => setVoiceover(e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Slide type">
          <Select value={type} onChange={(e) => setType(e.target.value as 'text' | 'diagram')}>
            <option value="text">Text</option>
            <option value="diagram">Diagram</option>
          </Select>
        </Field>
        <Field label="Diagram template" hint={type === 'text' ? 'Only applies to diagram slides.' : undefined}>
          <Select value={diagram} onChange={(e) => setDiagram(e.target.value)} disabled={type === 'text'}>
            <option value="none">none</option>
            {(meta?.diagram_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
      </div>

      {type === 'text' ? (
        <div className="flex flex-col gap-3">
          <Checkbox checked={imageNeeded} onChange={(e) => setImageNeeded(e.target.checked)} label="Include a supporting image" />
          {imageNeeded && (
            <Field label="Search queries" hint="One per line. Be specific — “ResNet50 architecture diagram” beats “neural network”.">
              <Textarea rows={3} value={queries} onChange={(e) => setQueries(e.target.value)} />
            </Field>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-fog-600">Diagram slides use animated Manim visuals instead of photographs.</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={save} loading={saving}><Check className="size-3.5" />Save</Button>
        <Button size="sm" variant="ghost" onClick={async () => { await api.full.resetSlide(sessionId, index); onDone() }}>
          <RotateCcw className="size-3.5" />Reset
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="size-3.5" />Cancel</Button>
      </div>
    </div>
  )
}

function RegenPanel({ sessionId, index, onDone, onCancel }: {
  sessionId: string; index: number; onDone: () => void; onCancel: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [full, setFull] = useState(true)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, { onDone, onError: () => setJobId(null) })

  if (jobId) {
    return (
      <div className="mt-5 border-t border-ink-800 pt-5">
        <p className="mb-2.5 text-[12px] text-fog-500">{job.message || 'Regenerating…'}</p>
        <ProgressBar value={job.progress} />
        <LogConsole lines={job.log} className="mt-3 max-h-40" />
      </div>
    )
  }

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-ink-800 pt-5">
      <Field label="Instructions" hint="Optional. Anything here takes priority over the original prompt.">
        <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Add a real-world example, use simpler language…" />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant={full ? 'secondary' : 'ghost'} onClick={() => setFull(true)}>Whole slide</Button>
        <Button size="sm" variant={!full ? 'secondary' : 'ghost'} onClick={() => setFull(false)}>Narration only</Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={async () => {
          const { job_id } = await api.full.regenSlide(sessionId, index, {
            mode: full ? 'full' : 'voiceover_only', custom_prompt: prompt,
          })
          setJobId(job_id)
        }}>
          <Sparkles className="size-3.5" />Regenerate
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="size-3.5" />Cancel</Button>
      </div>
    </div>
  )
}
