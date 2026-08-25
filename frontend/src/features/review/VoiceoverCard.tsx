import { useState } from 'react'
import { api } from '@/api/client'
import type { SlidesPipelineSlide } from '@/api/types'
import { Expander } from '@/components/ui/Accordion'
import { Textarea } from '@/components/ui/primitives'
import { estimateDuration, wordCount } from '@/lib/utils'

export function VoiceoverCard({ sessionId, index, slide }: {
  sessionId: string; index: number; slide: SlidesPipelineSlide
}) {
  const [voiceover, setVoiceover] = useState(slide.voiceover)
  const [saving, setSaving] = useState(false)
  const dur = estimateDuration(voiceover)
  const wc = wordCount(voiceover)

  async function save() {
    if (voiceover === slide.voiceover) return
    setSaving(true)
    try { await api.slides.editVoiceover(sessionId, index, voiceover) }
    finally { setSaving(false) }
  }

  return (
    <Expander
      title={
        <span className="flex items-baseline gap-2.5">
          <span className="font-mono text-[11px] text-fog-600">{String(index + 1).padStart(2, '0')}</span>
          <span>{slide.title || `Slide ${index + 1}`}</span>
        </span>
      }
      meta={`~${dur}s`}
    >
      <Textarea rows={6} value={voiceover} onChange={(e) => setVoiceover(e.target.value)} onBlur={save} />
      <p className="mt-2 text-[11px] text-fog-600">
        {wc} words · ~{dur}s at render{saving && ' · saving'}
      </p>
      {(slide.retrieved_from?.length ?? 0) > 0 && (
        <p className="mt-1 truncate text-[11px] text-fog-600"
           title={slide.retrieved_from!.join(' · ')}>
          grounded in {slide.retrieved_from!.join(' · ')}
        </p>
      )}
    </Expander>
  )
}
