import type { Brain, SessionRecord, Totals, Vitals } from '../types'

// Daily history across sessions. Each session saves its own running totals
// under its own store key, so sessions open at once never overwrite each
// other; a new session adds up the others by local day.

export const KEEP_DAYS = 45
export const ZERO: Totals = { actions: 0, errors: 0, tasks: 0, edits: 0, costUsd: 0, busyMs: 0 }

export function dayOf(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export function add(a: Totals, b: Totals): Totals {
  return {
    actions: a.actions + b.actions,
    errors: a.errors + b.errors,
    tasks: a.tasks + b.tasks,
    edits: a.edits + b.edits,
    costUsd: a.costUsd + b.costUsd,
    busyMs: a.busyMs + b.busyMs,
  }
}

export function totalsOf(b: Brain, v: Vitals): Totals {
  return {
    actions: b.total,
    errors: b.errors,
    tasks: b.counts.core,
    edits: b.counts.build,
    costUsd: v.costUsd ?? 0,
    busyMs: v.busyMs ?? 0,
  }
}

const isRecord = (x: unknown): x is SessionRecord =>
  typeof x === 'object' && x !== null && typeof (x as SessionRecord).day === 'string' && typeof (x as SessionRecord).actions === 'number'

// Records by day, leaving out what is malformed.
export function aggregate(records: unknown[]): Record<string, Totals> {
  const days: Record<string, Totals> = {}
  for (const r of records) {
    if (!isRecord(r)) continue
    days[r.day] = add(days[r.day] ?? ZERO, { ...ZERO, ...r })
  }
  return days
}

// The last `n` days ending today, oldest first, empty days as zero.
export function lastDays(days: Record<string, Totals>, n: number, now: number): { day: string; t: Totals }[] {
  return Array.from({ length: n }, (_, i) => {
    const day = dayOf(now - (n - 1 - i) * 86400000)
    return { day, t: days[day] ?? ZERO }
  })
}

export const isStale = (day: string, now: number) => day < dayOf(now - KEEP_DAYS * 86400000)

// A bar per day; today's burns brightest.
export function chartSvg(series: { day: string; t: Totals }[]): string {
  const W = 320
  const H = 74
  const gap = 5
  const bw = (W - gap * (series.length - 1)) / series.length
  const max = Math.max(1, ...series.map(s => s.t.actions))
  const bars = series
    .map((s, i) => {
      const x = i * (bw + gap)
      const h = s.t.actions === 0 ? 1.5 : Math.max(3, (s.t.actions / max) * 50)
      const isToday = i === series.length - 1
      const letter = 'SMTWTFS'[new Date(`${s.day}T12:00:00`).getDay()]
      return `<rect x="${x.toFixed(1)}" y="${(56 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${isToday ? '#fff1cf' : '#ff8a1f'}" opacity="${s.t.actions === 0 ? 0.25 : isToday ? 1 : 0.75}"/><text x="${(x + bw / 2).toFixed(1)}" y="70" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="9" fill="${isToday ? '#fff1cf' : '#c98a50'}">${letter}</text>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="M0 56.5H${W}" stroke="#7a3a10" stroke-width="1"/>${bars}</svg>`
}

// The same bars as text, for the terminal.
export function sparkline(series: { day: string; t: Totals }[]): string {
  const blocks = '▁▂▃▄▅▆▇█'
  const max = Math.max(1, ...series.map(s => s.t.actions))
  return series.map(s => (s.t.actions === 0 ? '·' : blocks[Math.min(7, Math.floor((s.t.actions / max) * 7.99))])).join('')
}
