import { Presentation, Shapes, Wand2 } from 'lucide-react'
import { useUIStore } from '@/store/session'
import type { Pipeline } from '@/api/types'
import { cn } from '@/lib/utils'

export const PIPELINE_META: Record<Pipeline, {
  label: string; short: string; icon: React.ReactNode; accent: string; active: string
}> = {
  full: {
    label: 'Full AI Generation', short: 'Full AI',
    icon: <Wand2 className="size-4" />,
    accent: 'text-amber-400',
    active: 'border-amber-400/35 bg-amber-400/10 text-amber-300',
  },
  slides: {
    label: 'Slides + Voiceover', short: 'Slides',
    icon: <Presentation className="size-4" />,
    accent: 'text-violet-400',
    active: 'border-violet-400/35 bg-violet-400/10 text-violet-300',
  },
  topic: {
    label: 'Topic Video', short: 'Topic',
    icon: <Shapes className="size-4" />,
    accent: 'text-teal-400',
    active: 'border-teal-400/35 bg-teal-400/10 text-teal-300',
  },
}

const ORDER: Pipeline[] = ['full', 'slides', 'topic']

export function PipelinePicker({ locked }: { locked?: boolean }) {
  const { pipelineChoice, setPipelineChoice } = useUIStore()
  return (
    <div className="flex flex-col gap-1">
      {ORDER.map((id) => {
        const m = PIPELINE_META[id]
        const on = pipelineChoice === id
        return (
          <button
            key={id}
            disabled={locked}
            onClick={() => setPipelineChoice(id)}
            className={cn(
              'flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[13px] transition-all duration-150',
              on ? m.active : 'border-transparent text-fog-500 hover:bg-ink-850 hover:text-fog-200',
              locked && 'cursor-default opacity-70',
            )}
          >
            <span className={cn('shrink-0', on ? '' : 'text-fog-600')}>{m.icon}</span>
            <span className="truncate font-medium">{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}
