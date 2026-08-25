import { useRef, useState } from 'react'
import { ImageOff, RefreshCw, Trash2, Upload } from 'lucide-react'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import type { Slide } from '@/api/types'
import { Badge, Button } from '@/components/ui/primitives'

export function ImagePanel({ sessionId, index, slide, onUpdated }: {
  sessionId: string; index: number; slide: Slide; onUpdated: () => void
}) {
  const [v, setV] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const job = useJob(jobId, {
    onDone: () => { setJobId(null); setV((n) => n + 1); onUpdated() },
    onError: () => setJobId(null),
  })

  const custom = slide.has_custom_image
  const preview = slide.has_preview_image
  const hasImage = custom || preview
  const hasQueries = (slide.image?.search_queries?.length ?? 0) > 0

  return (
    <div className="mt-4 grid gap-4 rounded-md border border-ink-800 bg-ink-950/50 p-4 sm:grid-cols-[168px_1fr]">
      <div>
        {hasImage ? (
          <img
            src={api.full.slideImageUrl(sessionId, index, v)} alt=""
            className="aspect-[4/3] w-full rounded-sm border border-ink-700 object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-ink-700 text-fog-600">
            <ImageOff className="size-4" />
            <span className="text-[10px]">No image</span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          {custom ? <Badge tone="teal">Custom upload</Badge>
            : preview ? <Badge tone="neutral">Fetched · vision checked</Badge>
            : <Badge tone="muted">Empty</Badge>}
        </div>

        {jobId ? (
          <p className="text-[12px] text-fog-500">{job.message || 'Fetching…'}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {hasQueries && !custom && (
              <Button size="sm" variant="secondary" onClick={async () => {
                const { job_id } = await api.full.refetchImage(sessionId, index); setJobId(job_id)
              }}>
                <RefreshCw className="size-3.5" />{preview ? 'Re-fetch' : 'Fetch image'}
              </Button>
            )}
            <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" />Upload
            </Button>
            {custom && (
              <Button size="sm" variant="ghost" onClick={async () => {
                await api.full.deleteImage(sessionId, index); setV((n) => n + 1); onUpdated()
              }}>
                <Trash2 className="size-3.5" />Remove
              </Button>
            )}
          </div>
        )}

        {!hasQueries && !custom && (
          <p className="text-[11px] leading-relaxed text-fog-600">
            No search queries defined. Add some under Edit, or upload your own image.
          </p>
        )}

        <input
          ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            setUploading(true)
            try { await api.full.uploadImage(sessionId, index, f); setV((n) => n + 1); onUpdated() }
            finally { setUploading(false) }
          }}
        />
      </div>
    </div>
  )
}
