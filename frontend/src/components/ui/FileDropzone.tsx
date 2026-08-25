import { useCallback, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FileDropzone({
  label, hint, accept, multiple = true, files, onChange, className, required,
}: {
  label: string; hint?: string; accept?: string; multiple?: boolean
  files: File[]; onChange: (files: File[]) => void; className?: string; required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const add = useCallback((incoming: FileList | null) => {
    if (!incoming?.length) return
    onChange(multiple ? [...files, ...Array.from(incoming)] : [incoming[0]])
  }, [files, multiple, onChange])

  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[12px] font-medium text-fog-400">{label}</span>
        {required && <span className="text-[10px] font-medium text-amber-400/80">required</span>}
      </div>
      {hint && <p className="mb-2 text-[11px] leading-snug text-fog-600">{hint}</p>}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 py-4',
          'text-[12px] transition-colors duration-150',
          over
            ? 'border-amber-400/60 bg-amber-400/5 text-amber-300'
            : 'border-ink-700 bg-ink-950/40 text-fog-600 hover:border-ink-600 hover:text-fog-400',
        )}
      >
        <Paperclip className="size-3.5" />
        {files.length ? 'Add more' : 'Drop files or browse'}
      </button>

      <input
        ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = '' }}
      />

      {files.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="group flex items-center gap-2 rounded-xs bg-ink-850 px-2 py-1.5 text-[11px] text-fog-300">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                onKeyDown={(e) => { if (e.key === 'Enter') onChange(files.filter((_, j) => j !== i)) }}
                className="shrink-0 cursor-pointer text-fog-600 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
