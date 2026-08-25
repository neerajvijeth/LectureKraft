import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

export function RangeSlider({ value, onValueChange, min, max, step = 1, className }: {
  value: number; onValueChange: (v: number) => void
  min: number; max: number; step?: number; className?: string
}) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-5 w-full touch-none select-none items-center', className)}
      min={min} max={max} step={step}
      value={[value]}
      onValueChange={(v) => onValueChange(v[0])}
    >
      <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-ink-750">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-amber-400" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className={cn(
        'block size-4 rounded-full border-2 border-amber-400 bg-ink-950 transition-transform',
        'hover:scale-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/25',
      )} />
    </SliderPrimitive.Root>
  )
}
