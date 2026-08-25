import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { ErrorScreen, LoadingScreen } from '@/components/layout/AppShell'
import { UploadPhase } from './upload/UploadPhase'
import { FullReviewPhase } from './review/FullReviewPhase'
import { SlidesReviewPhase } from './review/SlidesReviewPhase'
import { TopicReviewPhase } from './review/TopicReviewPhase'
import { RenderPhase } from './render/RenderPhase'
import { DonePhase } from './done/DonePhase'

export function SessionShell() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data: session, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.getSession(sessionId!),
    enabled: !!sessionId,
    refetchOnMount: 'always',
    // A bad/expired session id is a 404, not a transient failure — retrying
    // just delays the error screen the user actually needs to see.
    retry: false,
  })

  // Warm the diagram/scene-type list as early as possible — the slide and
  // scene editors read it synchronously into a <select>, and fetching it
  // lazily inside those editors causes the select to briefly render with
  // only its "none" fallback option before the real value can match.
  useQuery({ queryKey: ['meta'], queryFn: api.getMeta, staleTime: Infinity })

  // Order matters: on a fetch failure `session` stays undefined forever, so
  // checking `!session` before `error` made the error screen unreachable —
  // an invalid or expired session URL just spun on "Loading session…" with
  // no way out except editing the address bar by hand.
  if (error) return <ErrorScreen message={(error as Error).message} />
  if (isLoading || !session) return <LoadingScreen label="Loading session…" />

  switch (session.phase) {
    case 'upload': return <UploadPhase session={session} />
    case 'review': return <FullReviewPhase session={session} />
    case 'rendering': return <RenderPhase session={session} pipeline="full" />
    case 'slides_review': return <SlidesReviewPhase session={session} />
    case 'slides_rendering': return <RenderPhase session={session} pipeline="slides" />
    case 'topic_review': return <TopicReviewPhase session={session} />
    case 'topic_rendering': return <RenderPhase session={session} pipeline="topic" />
    case 'done': return <DonePhase session={session} />
    default: return <UploadPhase session={session} />
  }
}
