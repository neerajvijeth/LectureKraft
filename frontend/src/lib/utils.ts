import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Matches app.py's slide_duration_seconds estimate: max(6, min(120, words/2.4)) */
export function estimateDuration(text: string): number {
  const words = Math.max(1, text.trim().split(/\s+/).filter(Boolean).length)
  return Math.max(6, Math.min(120, Math.round(words / 2.4)))
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.round(total % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
