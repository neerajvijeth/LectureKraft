import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export function Switch({ checked, onCheckedChange, label, hint, className }: {
  checked: boolean; onCheckedChange: (v: boolean) => void
  label?: string; hint?: string; className?: string
}) {
  return (
    <label className={cn('flex cursor-pointer items-center justify-between gap-3', className)}>
      {(label || hint) && (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && <span className="text-[13px] font-medium text-fog-200">{label}</span>}
          {hint && <span className="text-[11px] leading-snug text-fog-600">{hint}</span>}
        </span>
      )}
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200 outline-none',
          'border-ink-600 bg-ink-800',
          'data-[state=checked]:border-amber-400/40 data-[state=checked]:bg-amber-400/85',
          'focus-visible:ring-2 focus-visible:ring-amber-400/40',
        )}
      >
        <SwitchPrimitive.Thumb className={cn(
          'block size-4 translate-x-[2px] rounded-full bg-fog-400 shadow-sm',
          'transition-[transform,background-color] duration-200',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-ink-950',
        )} />
      </SwitchPrimitive.Root>
    </label>
  )
}
