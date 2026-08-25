import type { ReactNode } from 'react'
import { ProgressBar } from '@/components/ui/primitives'
import { LogConsole } from '@/components/ui/LogConsole'
import { FocusScreen } from '@/components/layout/AppShell'
import type { JobViewState } from '@/api/sse'

/** Vertical form section with a hairline divider above it. */
export function FormSection({ title, description, children }: {
  title: string; description?: string; children: ReactNode
}) {
  return (
    <section className="border-t border-ink-800 py-7 first:border-t-0 first:pt-0">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-fog-100">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-fog-500">{description}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

/** Shown full-screen while a structure/voiceover generation job runs. */
export function GeneratingScreen({ title, job }: { title: ReactNode; job: JobViewState }) {
  return (
    <FocusScreen title={title}>
      <p className="mb-3 text-center text-[13px] text-fog-500">{job.message || 'Starting…'}</p>
      <ProgressBar value={job.progress} />
      <LogConsole lines={job.log} className="mt-6" />
    </FocusScreen>
  )
}
