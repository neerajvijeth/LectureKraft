import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Wordmark } from './Logo'
import { KeyHealthWidget } from './KeyHealthWidget'
import { CorpusWidget } from './CorpusWidget'
import { cn } from '@/lib/utils'

// ── Workspace frame ──────────────────────────────────────────────────────
export function Workspace({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-950">
      {sidebar}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-10 lg:px-12">{children}</div>
      </main>
    </div>
  )
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className="flex h-full w-[286px] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <div className="shrink-0 px-5 py-5">
        <Link to="/" className="inline-block transition-opacity hover:opacity-75">
          <Wordmark />
        </Link>
      </div>
      <div className="scrollbar-thin flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-5">
        {children}
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t border-ink-800 p-4">
        <CorpusWidget />
        <KeyHealthWidget />
      </div>
    </aside>
  )
}

export function SidebarGroup({ title, children, className }: {
  title?: string; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      {title && <h2 className="eyebrow">{title}</h2>}
      {children}
    </section>
  )
}

// ── Page header ──────────────────────────────────────────────────────────
export function PageHeader({ eyebrow, title, meta, actions }: {
  eyebrow?: string; title: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode
}) {
  return (
    <header className="mb-8 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2.5">{eyebrow}</p>}
        <h1 className="display text-[clamp(1.75rem,3.5vw,2.4rem)] text-fog-50">{title}</h1>
        {meta && <p className="mt-2.5 text-[13px] text-fog-500">{meta}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  )
}

// ── Phase stepper ────────────────────────────────────────────────────────
const PHASES = ['Upload', 'Review', 'Render', 'Done'] as const

export function PhaseStepper({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {PHASES.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={label} className="flex items-center gap-2.5 py-1">
            <span className={cn(
              'flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors',
              done && 'border-amber-400/40 bg-amber-400/15 text-amber-400',
              active && 'border-amber-400 bg-amber-400 text-ink-950',
              !done && !active && 'border-ink-700 bg-ink-850 text-fog-600',
            )}>
              {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn(
              'text-[13px] transition-colors',
              active ? 'font-medium text-fog-100' : done ? 'text-fog-400' : 'text-fog-600',
            )}>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ── Full-screen states ───────────────────────────────────────────────────
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-ink-950">
      <div className="size-6 animate-spin rounded-full border-2 border-ink-700 border-t-amber-400" />
      <span className="text-[13px] text-fog-500">{label}</span>
    </div>
  )
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-ink-950 px-6">
      <div className="max-w-sm text-center">
        <h1 className="display mb-3 text-2xl text-fog-50">Something went wrong</h1>
        <p className="text-[13px] leading-relaxed text-fog-500">{message}</p>
        <Link to="/" className="mt-6 inline-block text-[13px] text-amber-400 hover:text-amber-300">
          Back to start
        </Link>
      </div>
    </div>
  )
}

/** Centered full-screen panel used while a generation or render job runs. */
export function FocusScreen({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative isolate flex h-screen w-screen items-center justify-center overflow-hidden bg-ink-950 px-6 grain">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-drift absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.15]"
             style={{ background: 'radial-gradient(circle, #F5B544 0%, transparent 62%)', filter: 'blur(90px)' }} />
      </div>
      <div className="w-full max-w-lg">
        <h1 className="display mb-8 text-center text-[clamp(1.5rem,3vw,2rem)] leading-tight text-fog-50">{title}</h1>
        {children}
      </div>
    </div>
  )
}
