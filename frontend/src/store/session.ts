import { create } from 'zustand'
import type { Pipeline } from '@/api/types'

type CardMode = 'edit' | 'regen' | null

interface UIState {
  pipelineChoice: Pipeline
  setPipelineChoice: (p: Pipeline) => void

  // Client-only card interaction state — mirrors streamlit_app.py's
  // card_modes/topic_card_modes, which never left the browser session there
  // either. Reset whenever the session's slide/scene set changes.
  slideCardMode: Record<number, CardMode>
  setSlideCardMode: (i: number, mode: CardMode) => void
  resetSlideCardModes: () => void

  sceneCardMode: Record<number, CardMode>
  setSceneCardMode: (i: number, mode: CardMode) => void
  resetSceneCardModes: () => void

  // The job_id of an in-flight render, so RenderPhase can pick up live SSE
  // watching right after the "Finalize & Render" click. Cleared on
  // completion; if lost (e.g. a page reload mid-render), RenderPhase falls
  // back to polling the session instead of crashing.
  activeJobId: string | null
  setActiveJobId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  pipelineChoice: 'full',
  setPipelineChoice: (p) => set({ pipelineChoice: p }),

  slideCardMode: {},
  setSlideCardMode: (i, mode) => set((s) => ({ slideCardMode: { ...s.slideCardMode, [i]: mode } })),
  resetSlideCardModes: () => set({ slideCardMode: {} }),

  sceneCardMode: {},
  setSceneCardMode: (i, mode) => set((s) => ({ sceneCardMode: { ...s.sceneCardMode, [i]: mode } })),
  resetSceneCardModes: () => set({ sceneCardMode: {} }),

  activeJobId: null,
  setActiveJobId: (id) => set({ activeJobId: id }),
}))
