import * as React from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

// ── Button ───────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-amber-400 text-ink-950 font-semibold shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-8px_rgba(245,181,68,0.5)] hover:bg-amber-300 active:bg-amber-500',
  secondary:
    'bg-ink-800 text-fog-100 border border-ink-700 hover:bg-ink-750 hover:border-ink-600',
  outline:
    'bg-transparent text-fog-100 border border-ink-700 hover:border-fog-600 hover:bg-ink-900',
  ghost:
    'bg-transparent text-fog-400 hover:text-fog-100 hover:bg-ink-850',
  danger:
    'bg-transparent text-danger border border-danger/25 hover:bg-danger/10 hover:border-danger/40',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-sm gap-2 rounded-md',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-md',
}

export function Button({
  className, variant = 'secondary', size = 'md', loading, disabled, children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: ButtonSize; loading?: boolean
}) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,transform,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant], SIZES[size], className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

// ── Surface / Card ───────────────────────────────────────────────────────
export function Surface({ className, lit, ...props }: React.HTMLAttributes<HTMLDivElement> & { lit?: boolean }) {
  return (
    <div
      className={cn('rounded-lg border border-ink-700 bg-ink-900', lit && 'lit', className)}
      {...props}
    />
  )
}

// ── Badge ────────────────────────────────────────────────────────────────
type Tone = 'neutral' | 'amber' | 'violet' | 'teal' | 'muted' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'border-ink-700 bg-ink-800 text-fog-300',
  muted:   'border-ink-700/60 bg-ink-850 text-fog-600',
  amber:   'border-amber-400/25 bg-amber-400/10 text-amber-300',
  violet:  'border-violet-400/25 bg-violet-400/10 text-violet-300',
  teal:    'border-teal-400/25 bg-teal-400/10 text-teal-300',
  danger:  'border-danger/25 bg-danger/10 text-danger',
}

export function Badge({ tone = 'neutral', className, children }: {
  tone?: Tone; className?: string; children: React.ReactNode
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
      'text-[11px] font-medium leading-none tracking-wide',
      TONES[tone], className,
    )}>
      {children}
    </span>
  )
}

// ── Progress ─────────────────────────────────────────────────────────────
export function ProgressBar({ value, className, tone = 'amber' }: {
  value: number; className?: string; tone?: 'amber' | 'violet' | 'teal'
}) {
  const fill = { amber: 'bg-amber-400', violet: 'bg-violet-400', teal: 'bg-teal-400' }[tone]
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-ink-800', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', fill)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

// ── Form controls ────────────────────────────────────────────────────────
const FIELD = cn(
  'w-full rounded-md border border-ink-700 bg-ink-950/60 text-fog-100',
  'placeholder:text-fog-600 transition-colors duration-150',
  'focus:outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/15',
  'disabled:opacity-45 disabled:cursor-not-allowed',
)

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, 'h-10 px-3 text-sm', className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD, 'resize-y px-3 py-2.5 text-sm leading-relaxed', className)} {...props} />
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD, 'h-10 cursor-pointer px-3 text-sm', className)} {...props}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-fog-400">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-fog-600">{hint}</p>}
    </div>
  )
}

export function Checkbox({ className, label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer rounded-xs border-ink-600 bg-ink-950 accent-amber-400', className)}
      {...props}
    />
  )
  if (!label) return input
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-fog-300">
      {input}{label}
    </label>
  )
}

// ── Stat ─────────────────────────────────────────────────────────────────
export function Stat({ value, label, tone = 'default' }: {
  value: React.ReactNode; label: string; tone?: 'default' | 'accent'
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={cn(
        'display text-[28px] leading-none',
        tone === 'accent' ? 'text-amber-400' : 'text-fog-50',
      )}>
        {value}
      </div>
      <div className="eyebrow">{label}</div>
    </div>
  )
}

// ── Note (inline callout) ────────────────────────────────────────────────
export function Note({ children, className, icon }: {
  children: React.ReactNode; className?: string; icon?: React.ReactNode
}) {
  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-md border border-ink-700 bg-ink-900/70 px-4 py-3',
      'text-[13px] leading-relaxed text-fog-400',
      className,
    )}>
      {icon && <span className="mt-px shrink-0 text-fog-600">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm text-fog-400', className)}>
      <Loader2 className="size-4 animate-spin text-amber-400" />
      {label}
    </div>
  )
}
