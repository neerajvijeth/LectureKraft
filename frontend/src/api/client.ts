import type {
  CorpusStatus, JobSnapshot, KeyHealth, Meta, Scene, SessionState, Slide,
  SlidesPipelineSlide,
} from './types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ? JSON.stringify(body.detail) : detail
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) return res.json()
  return res as unknown as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const patchJson = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) })

// ── Session lifecycle ────────────────────────────────────────────────────
export const api = {
  createSession: () => req<SessionState>('/session', { method: 'POST' }),
  getSession: (sid: string) => req<SessionState>(`/session/${sid}`),
  resetSession: (sid: string) => req<SessionState>(`/session/${sid}/reset`, { method: 'POST' }),
  startOver: (sid: string) => req<SessionState>(`/session/${sid}/start-over`, { method: 'POST' }),
  backToReview: (sid: string) => req<SessionState>(`/session/${sid}/back-to-review`, { method: 'POST' }),

  getMeta: () => req<Meta>('/meta'),
  getKeyHealth: () => req<KeyHealth>('/health/keys'),

  // ── Uploads ──
  uploadReference: (
    sid: string, category: 'notes' | 'transcript' | 'slides', files: File[], course = '',
  ) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    if (course) fd.append('course', course)
    return req<{ category: string; files: number; chars: number; indexed: number; chunks: number }>(
      `/upload/${sid}/${category}`, { method: 'POST', body: fd },
    )
  },

  getCorpus: (course = '') =>
    req<CorpusStatus>(`/corpus${course ? `?course=${encodeURIComponent(course)}` : ''}`),
  deleteCorpusDoc: (docId: number) =>
    req<{ deleted: number }>(`/corpus/${docId}`, { method: 'DELETE' }),
  uploadPptx: (sid: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ filename: string; bytes: number }>(`/upload/${sid}/pptx`, { method: 'POST', body: fd })
  },

  // ── Full pipeline ──
  full: {
    generateStructure: (sid: string, body: { topic: string; target_duration_minutes: number; skip_diagrams: boolean }) =>
      req<{ job_id: string }>(`/full/${sid}/structure`, json(body)),
    prefetchImages: (sid: string) =>
      req<{ job_id: string }>(`/full/${sid}/prefetch-images`, { method: 'POST' }),
    updateSettings: (sid: string, body: { skip_diagrams: boolean }) =>
      req<{ skip_diagrams: boolean }>(`/full/${sid}/settings`, patchJson(body)),
    editSlide: (sid: string, i: number, body: {
      title: string; bullets: string[]; voiceover: string; type: string;
      diagram: string; image_needed: boolean; image_queries: string[];
    }) => req<{ slide: Slide; status: string; image_job_id: string | null }>(`/full/${sid}/slide/${i}`, patchJson(body)),
    resetSlide: (sid: string, i: number) =>
      req<{ slide: Slide; status: string; image_job_id: string | null }>(`/full/${sid}/slide/${i}/reset`, { method: 'POST' }),
    regenSlide: (sid: string, i: number, body: { mode: string; custom_prompt: string }) =>
      req<{ job_id: string }>(`/full/${sid}/slide/${i}/regen`, json(body)),
    slideImageUrl: (sid: string, i: number, version = 0) => `${BASE}/full/${sid}/slide/${i}/image?v=${version}`,
    refetchImage: (sid: string, i: number) =>
      req<{ job_id: string }>(`/full/${sid}/slide/${i}/image/refetch`, { method: 'POST' }),
    uploadImage: (sid: string, i: number, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return req<{ ok: boolean }>(`/full/${sid}/slide/${i}/image/upload`, { method: 'POST', body: fd })
    },
    deleteImage: (sid: string, i: number) =>
      req<{ ok: boolean }>(`/full/${sid}/slide/${i}/image`, { method: 'DELETE' }),
    render: (sid: string) => req<{ job_id: string }>(`/full/${sid}/render`, { method: 'POST' }),
  },

  // ── Slides-as-is pipeline ──
  slides: {
    generateVoiceovers: (sid: string, body: { context: string }) =>
      req<{ job_id: string }>(`/slides/${sid}/voiceovers`, json(body)),
    editVoiceover: (sid: string, i: number, voiceover: string) =>
      req<{ voiceover: string; word_count: number; slide_duration_seconds: number }>(
        `/slides/${sid}/slide/${i}`, patchJson({ voiceover }),
      ),
    render: (sid: string) => req<{ job_id: string }>(`/slides/${sid}/render`, { method: 'POST' }),
  },

  // ── Topic Video pipeline ──
  topic: {
    generateStructure: (sid: string, body: { topic: string; context: string; target_minutes: number }) =>
      req<{ job_id: string }>(`/topic/${sid}/structure`, json(body)),
    editScene: (sid: string, i: number, body: {
      title: string; voiceover: string; scene_type: string; duration_seconds: number;
    }) => req<{ scene: Scene; status: string }>(`/topic/${sid}/scene/${i}`, patchJson(body)),
    resetScene: (sid: string, i: number) =>
      req<{ scene: Scene; status: string }>(`/topic/${sid}/scene/${i}/reset`, { method: 'POST' }),
    regenScene: (sid: string, i: number, body: { custom_prompt: string }) =>
      req<{ job_id: string }>(`/topic/${sid}/scene/${i}/regen`, json(body)),
    render: (sid: string) => req<{ job_id: string }>(`/topic/${sid}/render`, { method: 'POST' }),
  },

  // ── Downloads ──
  downloadUrl: (sid: string, kind: 'video' | 'metadata' | 'description') => `${BASE}/session/${sid}/download/${kind}`,
  getResultMetadata: (sid: string) =>
    req<{ metadata: { total_slides: number; estimated_duration_minutes: number; target_audience: string; full_description?: string } }>(
      `/session/${sid}/download/metadata`,
    ),

  // ── Jobs ──
  jobEventsUrl: (jobId: string) => `${BASE}/jobs/${jobId}/events`,
}

export type { JobSnapshot, SlidesPipelineSlide }
