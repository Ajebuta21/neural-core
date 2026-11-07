import type { Spark } from '../types'

// The thought stream as rows: markers stand alone; consecutive finished,
// successful steps of the same kind fold into one row ("Read 5 files").

export type Row =
  | { kind: 'task'; key: string; s: Spark }
  | { kind: 'summary'; key: string; s: Spark }
  | { kind: 'compact'; key: string; s: Spark }
  | { kind: 'step'; key: string; items: Spark[] }

export const isTask = (s: Spark) => s.region === 'core' && (s.kind ?? 'task') === 'task'

export function matches(s: Spark, filter: string): boolean {
  if (filter === 'all') return true
  if (s.region === 'core') return false
  return filter === 'errors' ? s.isError : s.region === filter
}

const foldable = (s: Spark) => s.region !== 'core' && s.isDone && !s.isError

// Newest first, at most `limit` rows.
export function buildRows(feed: Spark[], filter: string, limit: number): Row[] {
  const rows: Row[] = []
  for (const s of feed) {
    if (!matches(s, filter)) continue
    if (s.region === 'core') {
      rows.push({ kind: s.kind ?? 'task', key: s.id, s } as Row)
      continue
    }
    const last = rows[rows.length - 1]
    const head = last?.kind === 'step' ? last.items[0]! : undefined
    if (last?.kind === 'step' && head && foldable(s) && foldable(head) && head.region === s.region && head.verb === s.verb) {
      last.items.push(s)
    } else {
      rows.push({ kind: 'step', key: s.id, items: [s] })
    }
  }
  return rows.reverse().slice(0, limit)
}

const PLURAL: Record<string, (n: number) => string> = {
  Read: n => `Read ${n} files`,
  Wrote: n => `Wrote ${n} files`,
  Edited: n => `Edited ${n} files`,
  Ran: n => `Ran ${n} commands`,
  'Searched code for': n => `Searched code ${n} times`,
  'Looked for files': n => `Looked for files ${n} times`,
  'Searched the web for': n => `Searched the web ${n} times`,
  Opened: n => `Opened ${n} pages`,
}

// A row's headline and the detail beside it.
export function headline(items: Spark[]): { verb: string; detail: string } {
  const first = items[0]!
  if (items.length === 1) return { verb: first.verb, detail: first.detail }
  const unique = [...new Set(items.map(s => s.detail).filter(d => d !== ''))]
  if (unique.length <= 1) return { verb: `${first.verb} ×${items.length}`, detail: unique[0] ?? '' }
  const plural = PLURAL[first.verb]
  const shown = unique.slice(0, 3).join(', ') + (unique.length > 3 ? ` +${unique.length - 3}` : '')
  return { verb: plural ? plural(unique.length) : `${first.verb} ×${items.length}`, detail: shown }
}

// What a finished task did, from its steps since it began.
export function summarize(feed: Spark[]): Spark['summary'] | undefined {
  const start = feed.map(isTask).lastIndexOf(true) + 1
  const steps = feed.slice(start).filter(s => s.region !== 'core')
  if (steps.length === 0) return undefined
  const files = [...new Set(steps.filter(s => s.region === 'build' && !s.isError && s.detail).map(s => s.detail))]
  return { steps: steps.length, files, errors: steps.filter(s => s.isError).length }
}
