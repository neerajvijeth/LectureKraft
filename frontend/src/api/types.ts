// Mirrors the dict shapes server/routes/*.py and app.py actually produce.
// Kept intentionally loose (permissive optional fields) rather than a tight
// contract, since these are AI-generated JSON structures whose exact key
// set can drift slide-to-slide — the backend is the source of truth.

export type Pipeline = 'full' | 'slides' | 'topic'

export type Phase =
  | 'upload'
  | 'review'
  | 'rendering'
  | 'slides_review'
  | 'slides_rendering'
  | 'topic_review'
  | 'topic_rendering'
  | 'done'

export type SlideStatus = 'original' | 'edited' | 'regenerated'

export interface SlideImage {
  needed: boolean
  search_queries: string[]
  placement?: string
}

export interface Slide {
  retrieved_from?: string[]
  slide_index: number
  title: string
  type: 'text' | 'diagram'
  bullets: string[]
  voiceover: string
  formula?: string
  diagram?: string
  diagram_params?: Record<string, unknown>
  diagram_needed?: boolean
  slide_duration_seconds: number
  image: SlideImage
  status: SlideStatus
  has_preview_image: boolean
  has_custom_image: boolean
}

export interface SlidesPipelineSlide {
  retrieved_from?: string[]
  slide_index: number
  title: string
  voiceover: string
  slide_duration_seconds: number
}

export interface Scene {
  scene_index: number
  title: string
  scene_type: string
  duration_seconds: number
  voiceover: string
  params: Record<string, unknown>
  status: SlideStatus
}

export interface StructureMetadata {
  total_slides: number
  estimated_duration_minutes: number
  target_audience: string
  full_description?: string
}

export interface TopicStructureMeta {
  video_title?: string
  description?: string
  total_scenes?: number
  estimated_minutes?: number
}

export interface SessionState {
  session_id: string
  phase: Phase
  pipeline: Pipeline

  topic: string
  target_duration_minutes: number
  skip_diagrams: boolean
  structure_metadata: StructureMetadata | null
  slides: Slide[] | null
  n_modified: number
  images_prefetched: boolean

  slides_pptx_filename: string
  slides_context: string
  slides_pipeline: SlidesPipelineSlide[] | null

  topic_topic: string
  topic_context: string
  topic_minutes: number
  topic_structure_meta: TopicStructureMeta | null
  topic_scenes: Scene[] | null

  output_ready: boolean
  metadata_available: boolean
  description_available: boolean
  render_elapsed: number | null
  render_error: string | null
  render_traceback: string | null
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export interface JobSnapshot {
  id: string
  kind: string
  status: JobStatus
  progress: number
  message: string
  new_log: string[]
  log_len: number
  result: unknown
  error: string | null
  traceback: string | null
}

export interface KeySnapshot {
  label: string
  key_suffix: string
  rpm_used: number
  rpm_limit: number
  tpm_used: number
  tpm_limit: number
  rpd_used: number
  rpd_limit: number
  tpd_used: number
  tpd_limit: number
  cooling_down: boolean
  cooldown_remaining: number
  total_requests: number
  total_429: number
}

export interface KeyHealth {
  model: string
  tier: string
  keys_configured: number
  keys_active: number
  keys_cooling_down: number
  tokens_today: number
  tokens_today_limit: number
  requests_today: number
  keys: KeySnapshot[]
}

export interface Meta {
  diagram_types: string[]
  scene_types: string[]
}


export interface CorpusDoc {
  doc_id: number
  filename: string
  category: string
  course: string
  chars: number
  chunks: number
  added_at: number
}

export interface CorpusStatus {
  documents: number
  chunks: number
  courses: string[]
  vectors: number
  dense_enabled: boolean
  embed_model: string
  items: CorpusDoc[]
}
