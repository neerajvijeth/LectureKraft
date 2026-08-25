import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Pipeline, SessionState } from '@/api/types'
import { api } from '@/api/client'
import { useJob } from '@/api/sse'
import { useUIStore } from '@/store/session'
import { FocusScreen } from '@/components/layout/AppShell'
import { Note, ProgressBar } from '@/components/ui/primitives'
import { LogConsole } from '@/components/ui/LogConsole'

const COPY: Record<Pipeline, { title: string; note: string; tone: 'amber' | 'violet' | 'teal' }> = {
  full: {
    title: 'Composing your lecture',
    note: 'Manim diagrams, fetched imagery and neural narration are being assembled into a single MP4.',
    tone: 'amber',
  },
  slides: {
    title: 'Narrating your deck',
    note: 'Your slides are rendering to frames and merging with the generated audio.',
    tone: 'violet',
  },
  topic: {
    title: 'Animating your scenes',
    note: 'Every scene renders through Manim then syncs to its narration. This is the slow part.',
    tone: 'teal',
  },
}

export function RenderPhase({ session, pipeline }: { session: SessionState; pipeline: Pipeline }) {
  const qc = useQueryClient()
  const { activeJobId, setActiveJobId } = useUIStore()
  const copy = COPY[pipeline]

  const job = useJob(activeJobId, {
    onDone: () => { setActiveJobId(null); qc.invalidateQueries({ queryKey: ['session', session.session_id] }) },
    onError: () => { setActiveJobId(null); qc.invalidateQueries({ queryKey: ['session', session.session_id] }) },
  })

  // A reload mid-render loses the job id, so fall back to polling the session
  // until the backend moves the phase off *_rendering.
  const [tick, setTick] = useState(0)
  const polling = useRef(false)

  useEffect(() => {
    if (activeJobId) return
    polling.current = true
    const id = setInterval(() => setTick((t) => t + 1), 2500)
    return () => { clearInterval(id); polling.current = false }
  }, [activeJobId])

  useEffect(() => {
    if (!polling.current) return
    api.getSession(session.session_id).then((fresh) => {
      if (fresh.phase !== session.phase) qc.setQueryData(['session', session.session_id], fresh)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return (
    <FocusScreen title={copy.title}>
      <p className="mb-7 text-center text-[13px] leading-relaxed text-fog-500">{copy.note}</p>

      {activeJobId ? (
        <>
          <div className="mb-2.5 flex items-baseline justify-between gap-4">
            <span className="text-[13px] text-fog-300">{job.message || 'Starting…'}</span>
            <span className="font-mono text-[11px] text-fog-600">{job.progress}%</span>
          </div>
          <ProgressBar value={job.progress} tone={copy.tone} />
          <LogConsole lines={job.log} className="mt-6" />
        </>
      ) : (
        <Note>
          Rendering is still running. Live status can't reconnect after a page reload,
          but this screen will move on by itself once the video is ready.
        </Note>
      )}

      <p className="mt-6 text-center text-[11px] text-fog-600">Keep this tab open.</p>
    </FocusScreen>
  )
}
