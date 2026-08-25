import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Library, Trash2 } from 'lucide-react'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'

/** Shows what source material is indexed and available for retrieval. Without
 *  this, RAG is invisible — you cannot tell whether a lecture was grounded in
 *  your textbook or written from the model's own knowledge. */
export function CorpusWidget() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['corpus'], queryFn: () => api.getCorpus(),
    refetchInterval: 15000, retry: false,
  })

  if (!data) return null
  const empty = data.documents === 0

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xs px-1 py-1 text-left transition-colors hover:bg-ink-850"
      >
        <Library className={cn('size-3 shrink-0', empty ? 'text-fog-600' : 'text-teal-400')} />
        <span className="flex-1 text-[11px] font-medium text-fog-400">
          {empty ? 'No sources indexed' : `${data.documents} source${data.documents > 1 ? 's' : ''} · ${data.chunks} chunks`}
        </span>
        {!empty && <ChevronDown className={cn('size-3 text-fog-600 transition-transform', open && 'rotate-180')} />}
      </button>

      {empty && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-fog-600">
          Upload notes to ground narration in your own material.
        </p>
      )}

      {open && !empty && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-ink-800 px-1 pt-2.5">
          <p className="text-[10px] text-fog-600">
            {data.dense_enabled ? 'Hybrid BM25 + embeddings' : 'BM25 only'}
          </p>
          {data.items.slice(0, 8).map((d) => (
            <div key={d.doc_id} className="group flex items-center gap-2 text-[10px]">
              <span className="min-w-0 flex-1 truncate text-fog-500" title={d.filename}>
                {d.filename}
              </span>
              <span className="shrink-0 text-fog-600">{d.chunks}</span>
              <button
                onClick={async () => {
                  await api.deleteCorpusDoc(d.doc_id)
                  qc.invalidateQueries({ queryKey: ['corpus'] })
                }}
                className="shrink-0 text-fog-600 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                title="Remove from corpus"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
