import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight, AudioLines, Film, Image as ImageIcon, KeyRound,
  PencilLine, Presentation, Shapes, Sparkles, Wand2,
} from 'lucide-react'
import { api } from '@/api/client'
import type { Pipeline } from '@/api/types'
import { useUIStore } from '@/store/session'
import { Button } from '@/components/ui/primitives'
import { Wordmark } from '@/components/layout/Logo'
import { cn } from '@/lib/utils'

// ── Motion presets ───────────────────────────────────────────────────────
// Content starts at opacity 0, so under reduced-motion we must hand back a
// no-op variant rather than a disabled animation — otherwise the whole page
// below the fold stays invisible.
const RISE = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.55, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] as const },
  }),
}
const STATIC = { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } }

const viewport = { once: true, margin: '-80px' }

// ── Content ──────────────────────────────────────────────────────────────
const PIPELINES: {
  id: Pipeline; name: string; tagline: string; body: string
  icon: React.ReactNode; accent: string; ring: string; dot: string
}[] = [
  {
    id: 'full',
    name: 'Full AI Generation',
    tagline: 'From your course material',
    body: 'Feed it notes, a transcript, and a deck. It decides the slide breakdown, writes narration grounded in your sources, animates the diagrams and finds supporting imagery.',
    icon: <Wand2 className="size-5" />,
    accent: 'text-amber-400', ring: 'hover:border-amber-400/40', dot: 'bg-amber-400',
  },
  {
    id: 'slides',
    name: 'Slides + Voiceover',
    tagline: 'Keep your own deck',
    body: 'Your PPTX renders exactly as you built it — not one pixel moves. The AI writes a script for each slide and narrates over the top.',
    icon: <Presentation className="size-5" />,
    accent: 'text-violet-400', ring: 'hover:border-violet-400/40', dot: 'bg-violet-400',
  },
  {
    id: 'topic',
    name: 'Topic Video',
    tagline: 'Nothing but a subject',
    body: 'Type a topic and get a fully animated explainer — no slides, no photos. Twenty-three Manim templates cover derivations, plots, networks and proofs.',
    icon: <Shapes className="size-5" />,
    accent: 'text-teal-400', ring: 'hover:border-teal-400/40', dot: 'bg-teal-400',
  },
]

const STEPS = [
  { n: '01', title: 'Bring your material', body: 'Notes, transcript, slide deck — or just a topic if you are starting cold.' },
  { n: '02', title: 'The AI drafts a structure', body: 'Slide breakdown, bullet content, diagram choices and narration, grounded in what you uploaded.' },
  { n: '03', title: 'Review every slide', body: 'Edit copy, swap diagram types, regenerate a slide, replace an image. Nothing renders until you say so.' },
  { n: '04', title: 'Render the video', body: 'Manim animations, neural TTS and your slides composed into a single 1920×1080 MP4.' },
]

const CAPABILITIES = [
  { icon: <PencilLine className="size-4" />, title: 'Grounded scripts', body: 'Narration is written from your notes and transcript, not invented.' },
  { icon: <Film className="size-4" />, title: '23 Manim templates', body: 'Derivations, plots, neural nets, timelines, Venn diagrams, force bodies.' },
  { icon: <ImageIcon className="size-4" />, title: 'Vision-checked imagery', body: 'Every fetched image is scored for relevance before it reaches a slide.' },
  { icon: <AudioLines className="size-4" />, title: 'Neural narration', body: 'Edge TTS voices, generated in parallel and timed to each slide.' },
  { icon: <Sparkles className="size-4" />, title: 'Per-slide regeneration', body: 'Redo one slide with custom instructions instead of the whole deck.' },
  { icon: <KeyRound className="size-4" />, title: 'Rate-limit aware', body: 'Rotates across API keys automatically so long runs do not stall.' },
]

// ── Page ─────────────────────────────────────────────────────────────────
export function LandingPage() {
  const navigate = useNavigate()
  const setPipelineChoice = useUIStore((s) => s.setPipelineChoice)
  const [starting, setStarting] = useState<Pipeline | 'any' | null>(null)
  const rise = useReducedMotion() ? STATIC : RISE

  async function start(pipeline: Pipeline = 'full') {
    setStarting(pipeline)
    try {
      setPipelineChoice(pipeline)
      const s = await api.createSession()
      navigate(`/s/${s.session_id}`)
    } catch {
      setStarting(null)
    }
  }

  return (
    <div className="min-h-screen bg-ink-950">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-ink-800/70 glass">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Wordmark />
          <div className="hidden items-center gap-8 md:flex">
            <a href="#pipelines" className="text-[13px] text-fog-400 transition-colors hover:text-fog-100">Pipelines</a>
            <a href="#how" className="text-[13px] text-fog-400 transition-colors hover:text-fog-100">How it works</a>
            <a href="#capabilities" className="text-[13px] text-fog-400 transition-colors hover:text-fog-100">Capabilities</a>
          </div>
          <Button variant="primary" size="sm" onClick={() => start('full')} loading={starting !== null}>
            Start creating <ArrowRight className="size-3.5" />
          </Button>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden grain">
        {/* ambient light */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="animate-drift absolute -top-40 left-1/2 size-[680px] -translate-x-1/2 rounded-full opacity-[0.20]"
               style={{ background: 'radial-gradient(circle, #F5B544 0%, transparent 62%)', filter: 'blur(90px)' }} />
          <div className="animate-drift absolute -right-32 top-24 size-[440px] rounded-full opacity-[0.16]"
               style={{ background: 'radial-gradient(circle, #7C68F0 0%, transparent 62%)', filter: 'blur(90px)', animationDelay: '-7s' }} />
          <div className="animate-drift absolute -left-40 top-64 size-[400px] rounded-full opacity-[0.13]"
               style={{ background: 'radial-gradient(circle, #3DAF97 0%, transparent 62%)', filter: 'blur(90px)', animationDelay: '-14s' }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-28 pt-24 md:pt-32">
          <motion.div initial="hidden" animate="show" className="max-w-3xl">
            <motion.div variants={rise} custom={0}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/70 py-1 pl-1 pr-3">
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300">NEW</span>
              <span className="text-[12px] text-fog-400">Three pipelines, one workspace</span>
            </motion.div>

            <motion.h1 variants={rise} custom={1}
              className="display text-[clamp(2.75rem,7vw,4.75rem)] text-fog-50">
              Turn course material into
              <br />
              narrated lecture <em className="text-amber-400">videos</em>.
            </motion.h1>

            <motion.p variants={rise} custom={2}
              className="mt-7 max-w-xl text-[17px] leading-relaxed text-fog-400">
              Upload your notes, bring your own slides, or start from nothing but a topic.
              The AI drafts the script, animates the diagrams and narrates the whole thing —
              and you review every slide before a single frame renders.
            </motion.p>

            <motion.div variants={rise} custom={3} className="mt-9 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={() => start('full')} loading={starting !== null}>
                Start creating <ArrowRight className="size-4" />
              </Button>
              <Button variant="outline" size="lg" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>
                See how it works
              </Button>
            </motion.div>

            <motion.p variants={rise} custom={4} className="mt-6 text-[12px] text-fog-600">
              Runs locally · Your material never leaves your machine except for model calls
            </motion.p>
          </motion.div>
        </div>

        <div className="rule mx-auto max-w-6xl" />
      </section>

      {/* ── Pipelines ── */}
      <section id="pipelines" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
        <motion.div initial="hidden" whileInView="show" viewport={viewport} variants={rise}>
          <p className="eyebrow mb-3">Three ways to start</p>
          <h2 className="display max-w-lg text-[clamp(1.9rem,4vw,2.75rem)] text-fog-50">
            Pick the one that matches what you already have.
          </h2>
        </motion.div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PIPELINES.map((p, i) => (
            <motion.button
              key={p.id}
              initial="hidden" whileInView="show" viewport={viewport} variants={rise} custom={i}
              onClick={() => start(p.id)}
              disabled={starting !== null}
              className={cn(
                'group lit relative flex flex-col items-start rounded-lg border border-ink-700 bg-ink-900 p-6 text-left',
                'transition-all duration-200 hover:-translate-y-1 hover:bg-ink-850 disabled:opacity-60',
                p.ring,
              )}
            >
              <span className={cn('mb-5 rounded-md border border-ink-700 bg-ink-800 p-2.5', p.accent)}>
                {p.icon}
              </span>
              <span className="eyebrow mb-1.5">{p.tagline}</span>
              <h3 className="mb-2.5 text-[17px] font-semibold text-fog-50">{p.name}</h3>
              <p className="mb-6 text-[13px] leading-relaxed text-fog-500">{p.body}</p>
              <span className={cn('mt-auto inline-flex items-center gap-1.5 text-[13px] font-medium', p.accent)}>
                Start here
                <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
              </span>
            </motion.button>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="relative scroll-mt-20 border-y border-ink-800 bg-ink-900/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <motion.div initial="hidden" whileInView="show" viewport={viewport} variants={rise}>
            <p className="eyebrow mb-3">How it works</p>
            <h2 className="display max-w-lg text-[clamp(1.9rem,4vw,2.75rem)] text-fog-50">
              You stay in the loop at every step.
            </h2>
          </motion.div>

          <ol className="mt-14 grid gap-px overflow-hidden rounded-lg border border-ink-700 bg-ink-700 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.n}
                initial="hidden" whileInView="show" viewport={viewport} variants={rise} custom={i}
                className="flex flex-col bg-ink-900 p-6"
              >
                <span className="display mb-4 text-[32px] leading-none text-ink-600">{s.n}</span>
                <h3 className="mb-2 text-[15px] font-semibold text-fog-50">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-fog-500">{s.body}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section id="capabilities" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
        <motion.div initial="hidden" whileInView="show" viewport={viewport} variants={rise}>
          <p className="eyebrow mb-3">Under the hood</p>
          <h2 className="display max-w-lg text-[clamp(1.9rem,4vw,2.75rem)] text-fog-50">
            Built for lectures, not generic slideshows.
          </h2>
        </motion.div>

        <div className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c, i) => (
            <motion.div
              key={c.title}
              initial="hidden" whileInView="show" viewport={viewport} variants={rise} custom={i % 3}
            >
              <div className="mb-3 flex size-8 items-center justify-center rounded-md border border-ink-700 bg-ink-850 text-amber-400">
                {c.icon}
              </div>
              <h3 className="mb-1.5 text-[14px] font-semibold text-fog-100">{c.title}</h3>
              <p className="text-[13px] leading-relaxed text-fog-500">{c.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      {/* grain + glow live on the full-bleed section, not the inner container —
          on the container they paint a visibly lighter inset rectangle. */}
      <section className="relative isolate overflow-hidden border-t border-ink-800 grain">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="animate-drift absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.17]"
               style={{ background: 'radial-gradient(circle, #F5B544 0%, transparent 62%)', filter: 'blur(90px)' }} />
        </div>
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <motion.div initial="hidden" whileInView="show" viewport={viewport} variants={rise}>
            <h2 className="display mx-auto max-w-2xl text-[clamp(2rem,5vw,3.25rem)] text-fog-50">
              Your next lecture is a few minutes away.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-fog-400">
              Start with whatever you have on hand. You can always switch pipelines later.
            </p>
            <div className="mt-9 flex justify-center">
              <Button variant="primary" size="lg" onClick={() => start('full')} loading={starting !== null}>
                Start creating <ArrowRight className="size-4" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Wordmark />
          <p className="text-[12px] text-fog-600">Manim · Edge TTS · Groq</p>
        </div>
      </footer>
    </div>
  )
}
