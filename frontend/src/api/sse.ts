import { useEffect, useRef, useState } from 'react'
import { api } from './client'
import type { JobSnapshot } from './types'

export interface JobViewState {
  status: JobSnapshot['status'] | 'idle'
  progress: number
  message: string
  log: string[]
  result: unknown
  error: string | null
  traceback: string | null
}

const IDLE: JobViewState = {
  status: 'idle', progress: 0, message: '', log: [], result: null, error: null, traceback: null,
}

/**
 * Streams a job's progress via SSE. Pass `onDone`/`onError` for one-shot
 * side effects (e.g. refetch the session) — they fire exactly once per job.
 */
export function useJob(
  jobId: string | null,
  opts?: { onDone?: (result: unknown) => void; onError?: (error: string) => void },
) {
  const [state, setState] = useState<JobViewState>(IDLE)
  const firedRef = useRef(false)
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  useEffect(() => {
    if (!jobId) {
      setState(IDLE)
      return
    }
    firedRef.current = false
    setState({ ...IDLE, status: 'queued' })

    const es = new EventSource(api.jobEventsUrl(jobId))

    es.addEventListener('update', (evt) => {
      const snap: JobSnapshot = JSON.parse((evt as MessageEvent).data)
      setState((prev) => ({
        status: snap.status,
        progress: snap.progress,
        message: snap.message,
        log: snap.new_log.length ? [...prev.log, ...snap.new_log] : prev.log,
        result: snap.result,
        error: snap.error,
        traceback: snap.traceback,
      }))
      if (snap.status === 'done' && !firedRef.current) {
        firedRef.current = true
        optsRef.current?.onDone?.(snap.result)
        es.close()
      } else if (snap.status === 'error' && !firedRef.current) {
        firedRef.current = true
        optsRef.current?.onError?.(snap.error || 'Job failed')
        es.close()
      }
    })

    es.onerror = () => {
      // readyState distinguishes a transient network blip (CONNECTING — the
      // browser is about to retry on its own) from a fatal failure (CLOSED —
      // e.g. the job id 404s, which happens if the server restarted mid-job
      // under --reload). Only the latter needs surfacing: every screen that
      // calls useJob already has a working onError recovery path, but it was
      // never reached for a dead connection — the UI just sat on "Starting…"
      // or "Regenerating…" forever with no way out.
      if (es.readyState === EventSource.CLOSED && !firedRef.current) {
        firedRef.current = true
        setState((prev) => ({ ...prev, status: 'error', error: 'Lost connection to the server.' }))
        optsRef.current?.onError?.('Lost connection to the server.')
      }
    }

    return () => es.close()
  }, [jobId])

  return state
}
