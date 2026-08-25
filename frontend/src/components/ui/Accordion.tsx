import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

export function Expander({
  title, defaultOpen = false, children, icon, className, meta,
}: {
  title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
  icon?: React.ReactNode; className?: string; meta?: React.ReactNode
}) {
  return (
    <AccordionPrimitive.Root type="single" collapsible defaultValue={defaultOpen ? 'i' : undefined} className={className}>
      <AccordionPrimitive.Item value="i" className="overflow-hidden rounded-md border border-ink-700 bg-ink-900">
        <AccordionPrimitive.Header>
          <AccordionPrimitive.Trigger className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-850">
            {icon && <span className="shrink-0 text-fog-600">{icon}</span>}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fog-100">{title}</span>
            {meta && <span className="shrink-0 text-[11px] text-fog-600">{meta}</span>}
            <ChevronDown className="size-4 shrink-0 text-fog-600 transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content className="overflow-hidden data-[state=open]:animate-[accordion-down_200ms_ease-out] data-[state=closed]:animate-[accordion-up_200ms_ease-out]">
          <div className={cn('border-t border-ink-700 px-4 py-4 text-[13px] leading-relaxed text-fog-400')}>
            {children}
          </div>
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  )
}
