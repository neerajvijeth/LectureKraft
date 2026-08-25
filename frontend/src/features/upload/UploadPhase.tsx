import type { SessionState } from '@/api/types'
import { useUIStore } from '@/store/session'
import { FullUploadPanel } from './FullUploadPanel'
import { SlidesUploadPanel } from './SlidesUploadPanel'
import { TopicUploadPanel } from './TopicUploadPanel'

export function UploadPhase({ session }: { session: SessionState }) {
  const { pipelineChoice } = useUIStore()

  if (pipelineChoice === 'slides') return <SlidesUploadPanel session={session} />
  if (pipelineChoice === 'topic') return <TopicUploadPanel session={session} />
  return <FullUploadPanel session={session} />
}
