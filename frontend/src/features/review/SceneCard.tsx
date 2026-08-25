import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Sparkles, Undo2, X } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { Scene } from '@/api/types'
import { useUIStore } from '@/store/session'
import { Badge, Button, Field, Input, ProgressBar, Select, Textarea } from '@/components/ui/primitives'
import { LogConsole } from '@/components/ui/LogConsole'
import { wordCount } from '@/lib/utils'
import { ReviewCard, StatusBadge } from './shared'

export function SceneCard({ sessionId, index, scene }: { sessionId: string; index: number; scene: Scene }) {
  const qc = useQueryClient()
  const { sceneCardMode, setSceneCardMode } = useUIStore()
  const mode = sceneCardMode[index] ?? null
  const invalidate = () => qc.invalidateQueries({ queryKey: ['session', sessionId] })
  const close = () => setSceneCardMode(index, null)

  return (
    <ReviewCard status={scene.status}>
      <div className="p-5 pl-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 font-mono text-[11px] text-fog-600">{String(index + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-fog-50">{scene.title}</h3>
              <Badge tone="teal">{scene.scene_type}</Badge>
              <StatusBadge status={scene.status} />
            </div>
            {mode === null && scene.voiceover && (
              <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-fog-500">{scene.voiceover}</p>
            )}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-fog-600">
            {scene.duration_seconds}s · {wordCount(scene.voiceover)}w
          </span>
        </div>

        {mode === null && (
          <div className="mt-4 flex gap-1.5 opacity-70 transition-opacity group-hover/card:opacity-100">
            <Button size="sm" variant="ghost" onClick={() => setSceneCardMode(index, 'edit')}>
              <Pencil className="size-3.5" />Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSceneCardMode(index, 'regen')}>
              <Sparkles className="size-3.5" />Regenerate
            </Button>
            {scene.status !== 'original' && (
              <Button size="sm" variant="ghost" onClick={async () => { await api.topic.resetScene(sessionId, index); close(); invalidate() }}>
                <Undo2 className="size-3.5" />Reset
              </Button>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <SceneEditor sessionId={sessionId} index={index} scene={scene}
            onDone={() => { close(); invalidate() }} onCancel={close} />
        )}
        {mode === 'regen' && (
          <SceneRegen sessionId={sessionId} index={index}
            onDone={() => { close(); invalidate() }} onCancel={close} />
        )}
      </div>
    </ReviewCard>
  )
}

function SceneEditor({ sessionId, index, scene, onDone, onCancel }: {
  sessionId: string; index: number; scene: Scene; onDone: () => void; onCancel: () => void
}) {
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.getMeta, staleTime: Infinity })
  const [title, setTitle] = useState(scene.title)
  const [voiceover, setVoiceover] = useState(scene.voiceover)
  const [sceneType, setSceneType] = useState(scene.scene_type)
  const [duration, setDuration] = useState(scene.duration_seconds)
  const [saving, setSaving] = useState(false)

  return (
    <div className="mt-5 flex flex-col gap-5 border-t border-ink-800 pt-5">
      <div className="grid gap-5 md:grid-cols-[1fr_200px]">
        <Field label="Scene title">
          <Input value={title} maxLength={55} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Template">
          <Select value={sceneType} onChange={(e) => setSceneType(e.target.value)}>
            {(meta?.scene_types ?? [sceneType]).map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Narration" hint="120–180 words for content scenes; 15–30 for title and summary cards.">
        <Textarea rows={6} value={voiceover} onChange={(e) => setVoiceover(e.target.value)} />
      </Field>

      <Field label="Duration (seconds)" hint="Auto-adjusts to the narration length during render.">
        <Input type="number" min={8} max={120} value={duration}
          onChange={(e) => setDuration(Number(e.target.value))} className="max-w-32" />
      </Field>

      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={saving} onClick={async () => {
          setSaving(true)
          try {
            await api.topic.editScene(sessionId, index, {
              title, voiceover, scene_type: sceneType, duration_seconds: duration,
            })
            onDone()
          } finally { setSaving(false) }
        }}>
          <Check className="size-3.5" />Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="size-3.5" />Cancel</Button>
      </div>
    </div>
  )
}

function SceneRegen({ sessionId, index, onDone, onCancel }: {
  sessionId: string; index: number; onDone: () => void; onCancel: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJob(jobId, { onDone, onError: () => setJobId(null) })

  if (jobId) {
    return (
      <div className="mt-5 border-t border-ink-800 pt-5">
        <p className="mb-2.5 text-[12px] text-fog-500">{job.message || 'Regenerating…'}</p>
        <ProgressBar value={job.progress} tone="teal" />
        <LogConsole lines={job.log} className="mt-3 max-h-40" />
      </div>
    )
  }

  return (
    <div className="mt-5 flex flex-col gap-4 border-t border-ink-800 pt-5">
      <Field label="Instructions" hint="Optional. You can ask for a different template here too.">
        <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Make it a worked example with step-by-step math, use calculus_plot instead…" />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={async () => {
          const { job_id } = await api.topic.regenScene(sessionId, index, { custom_prompt: prompt })
          setJobId(job_id)
        }}>
          <Sparkles className="size-3.5" />Regenerate
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="size-3.5" />Cancel</Button>
      </div>
    </div>
  )
}
