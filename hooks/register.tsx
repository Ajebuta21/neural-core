import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Brain, History, Mode, Region, Spark, View, Vitals } from '../types'

import { drawBrain, LOBES, untilReset } from './brain-art'
import { buildRows, headline, isTask, summarize } from './stream'
import type { Row } from './stream'
import { add, aggregate, chartSvg, dayOf, isStale, lastDays, sparkline, totalsOf, ZERO } from './history'

const PANE = 'neural-core'
const TITLE = 'Neural Core'
const FEED_SIZE = 150
const SHOWN = 20

const fresh = (): Brain => ({
  counts: { see: 0, build: 0, exec: 0, search: 0, swarm: 0, link: 0, core: 0 },
  feed: [],
  total: 0,
  errors: 0,
  startedAt: Date.now(),
  mode: 'idle',
})

// Change the tag when Brain's fields change: an older stored value is then
// read as a fresh brain instead of a shape this code doesn't expect.
const brain = atom({ plugin: 'neural-core', key: 'brain' } as const, fresh(), {
  shape: 'brain-2',
})

const vitals = atom({ plugin: 'neural-core', key: 'vitals' } as const, { limits: [], isMuted: false } as Vitals, {
  shape: 'vitals-1',
})

const view = atom({ plugin: 'neural-core', key: 'view' } as const, { filter: 'all', expanded: [] } as View, {
  shape: 'view-1',
})

const history = atom({ plugin: 'neural-core', key: 'history' } as const, { days: {} } as History, {
  shape: 'history-1',
})

// A task this long gets a "done" chime when it ends.
const LONG_TASK_MS = 20000
// A permission prompt still open after this long gets a toast and a ding.
const WAIT_ALERT_MS = 1500
const MEMORY_WARN_PCT = 80

const AMBER = '#ff8a1f'
const WARN = '#ffd23f'
const HOT = '#fff1cf'
const PALE = '#ffc58a'
// Card borders and dividers.
const LINE = '#6b3410'
const RED = '#ff3b30'
const TAG: Record<Region, { name: string; color: string }> = {
  build: { name: 'BUILD', color: '#ff7a1a' },
  exec: { name: 'EXEC', color: '#ffb020' },
  link: { name: 'LINK', color: '#ff9a5c' },
  see: { name: 'SEE', color: '#ffc861' },
  search: { name: 'SEARCH', color: '#ff9238' },
  swarm: { name: 'SWARM', color: '#ff5e3a' },
  core: { name: 'TASK', color: AMBER },
}
const MODE: Record<Mode, { text: string; color: string }> = {
  idle: { text: 'IDLE', color: '#a0785a' },
  thinking: { text: 'THINKING', color: '#ffb020' },
  acting: { text: 'EXECUTING', color: AMBER },
}

function regionOf(tool: string): Exclude<Region, 'core'> {
  if (/^(Read|NotebookRead)$/.test(tool) || /screenshot|get_page_text|read_page|read_terminal/i.test(tool)) return 'see'
  if (/^(Write|Edit|NotebookEdit)$/.test(tool)) return 'build'
  if (/^(Bash|PowerShell)$/.test(tool) || /run_in_terminal/.test(tool)) return 'exec'
  if (/^(Grep|Glob|WebSearch|WebFetch|ToolSearch)$/.test(tool) || /search|find|scrape/i.test(tool)) return 'search'
  if (/^(Agent|Task|SendMessage)/.test(tool)) return 'swarm'
  return 'link'
}

function oneLine(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

// A tool call in plain words: "Edited register.tsx", "Ran npm test".
function describe(tool: string, input: Record<string, unknown>): { verb: string; detail: string } {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = (pick('file_path') || pick('notebook_path') || pick('path')).split('/').pop() ?? ''
  const host = (url: string) => url.replace(/^https?:\/\//, '').split('/')[0] ?? url
  switch (tool) {
    case 'Read':
      return { verb: 'Read', detail: file }
    case 'Write':
      return { verb: 'Wrote', detail: file }
    case 'Edit':
    case 'NotebookEdit':
      return { verb: 'Edited', detail: file }
    case 'Bash':
      return { verb: 'Ran', detail: pick('description') || pick('command') }
    case 'Grep':
      return { verb: 'Searched code for', detail: pick('pattern') }
    case 'Glob':
      return { verb: 'Looked for files', detail: pick('pattern') }
    case 'WebSearch':
      return { verb: 'Searched the web for', detail: pick('query') }
    case 'WebFetch':
      return { verb: 'Opened', detail: host(pick('url')) }
    case 'Agent':
      return { verb: 'Sent a helper to', detail: pick('description') }
    case 'Skill':
      return { verb: 'Used skill', detail: pick('skill') }
    case 'ToolSearch':
      return { verb: 'Loaded tools', detail: '' }
  }
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__')
    const action = (parts[parts.length - 1] ?? tool).replace(/_/g, ' ')
    const where = /Browser|chrome/i.test(tool) ? 'Browser' : (parts[1] ?? '').replace(/^plugin_|[-_]/g, ' ').trim()
    const what = pick('action') || pick('query') || pick('url') || pick('text')
    return { verb: `${where && !/^[0-9a-f-]{20,}$/.test(where) ? where + ': ' : ''}${action}`, detail: what }
  }
  return { verb: tool.replace(/([a-z])([A-Z])/g, '$1 $2'), detail: file || pick('description') }
}

// The live readings, as `$.session.usage()` and `session.measure` carry them.
type Usage = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function withUsage(v: Vitals, u: Usage): Vitals {
  const limits = u.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt }))
  return {
    ...v,
    contextPct: u.context.percent ?? v.contextPct,
    contextTokens: u.context.tokens ?? v.contextTokens,
    contextWindow: u.context.window,
    limits: limits.length > 0 ? limits : v.limits,
    costUsd: u.cost?.usd ?? v.costUsd,
  }
}

// A loop in the current task: the latest action repeated 3 times in the last
// 6 with no edit between (re-running tests after a fix is progress, not a
// loop), or 3 failures in a row. Answers the repeated action in words.
function loopIn(feed: Spark[]): string | undefined {
  const start = feed.map(isTask).lastIndexOf(true) + 1
  const steps = feed.slice(start).filter(s => s.region !== 'core' && s.isDone)
  const tail = steps.slice(-3)
  if (tail.length === 3 && tail.every(s => s.isError)) return `${tail[2]!.verb} ${tail[2]!.detail} (3 failures in a row)`.trim()
  const recent = steps.slice(-6)
  const latest = recent[recent.length - 1]
  if (!latest || latest.region === 'build') return undefined
  const sig = (s: Spark) => `${s.verb} ${s.detail}`.trim()
  const same = recent.filter(s => sig(s) === sig(latest))
  if (same.length < 3) return undefined
  const between = recent.slice(recent.indexOf(same[0]!))
  if (between.some(s => s.region === 'build' && !s.isError)) return undefined
  return `${sig(latest)} ×${same.length}`
}

// Save this session's running totals to the store, under its own key.
async function saveTotals($: EngineInterface) {
  const b = await read($, brain)
  const v = await read($, vitals)
  if (!v.sessionKey) return
  await $.store.set(`s:${v.sessionKey}`, { ...totalsOf(b, v), day: dayOf(b.startedAt) }).catch(() => undefined)
}

// Add up earlier sessions by day, dropping records past the keeping window.
async function loadHistory($: EngineInterface, own: string) {
  const now = Date.now()
  const records: unknown[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('s:') || key === `s:${own}`) continue
    const record = await $.store.get(key)
    const day = (record as { day?: unknown } | undefined)?.day
    if (typeof day === 'string' && isStale(day, now)) await $.store.delete(key)
    else records.push(record)
  }
  await update($, history, () => ({ days: aggregate(records) }))
}

// Write the vital signs only when they change: every write redraws the panel.
async function patchVitals($: EngineInterface, change: (v: Vitals) => Vitals): Promise<Vitals> {
  const before = await read($, vitals)
  const after = change(before)
  if (after === before || JSON.stringify(after) === JSON.stringify(before)) return before
  return update($, vitals, change)
}

async function chime($: EngineInterface, name: 'done' | 'ping' | 'alert') {
  const v = await read($, vitals)
  if (v.isMuted) return
  await $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

function took(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60000) return `${Math.round(ms / 100) / 10}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function clock(at: number, withSeconds = false): string {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}${withSeconds ? `:${two(d.getSeconds())}` : ''}`
}

const kTokens = (n: number | undefined) => (n === undefined ? '?' : `${Math.round(n / 1000)}k`)

function short(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function uptime(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brain', description: 'Open the Neural Core panel' })
    const v0 = await update($, vitals, v => ({
      ...v,
      bootAt: Date.now(),
      sessionKey: v.sessionKey ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    }))
    await loadHistory($, v0.sessionKey!).catch(() => undefined)
    void $.ui.open({ id: PANE, title: TITLE })
    try {
      const u = await $.session.usage()
      await patchVitals($, v => withUsage(v, u))
    } catch {
      // No reading yet: the gauges show "--" until the first one.
    }

    return next(e)
  })

  // Fires whenever memory, limits or cost move.
  on('session.measure', async ($, e, next) => {
    const before = await read($, vitals)
    const after = await patchVitals($, v => withUsage(v, e))
    if ((before.contextPct ?? 0) < MEMORY_WARN_PCT && (after.contextPct ?? 0) >= MEMORY_WARN_PCT) {
      $.ui.toast(`Memory is ${after.contextPct}% full. Consider /compact or a fresh session soon.`)
      await chime($, 'alert')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // A permission prompt put to the person: Claude is waiting on you.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && e.approver === 'person' && id) {
      const { verb, detail } = describe(e.tool, (e.input ?? {}) as Record<string, unknown>)
      const what = oneLine(`${verb} ${detail}`, 70)
      await update($, vitals, v => ({ ...v, waiting: { id, what, since: Date.now() } }))
      $.clock.after(WAIT_ALERT_MS, () => {
        void (async () => {
          if ((await read($, vitals)).waiting?.id !== id) return
          $.ui.toast(`Claude needs your OK: ${what}`)
          await chime($, 'ping')
        })()
      })
    }

    return verdict
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await saveTotals($)

    return next(e)
  })

  // The conversation was compacted: older messages summarized to free memory.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && !e.agentId && result.skip === undefined) {
      const at = Date.now()
      const mark: Spark = {
        id: `compact-${at}`,
        region: 'core',
        kind: 'compact',
        verb: 'Memory compacted',
        detail: e.trigger,
        isError: false,
        isDone: true,
        at,
        tokens: { before: result.tokensBefore, after: result.tokensAfter },
      }
      await update($, brain, b => ({ ...b, feed: [...b.feed, mark].slice(-FEED_SIZE) }))
    }

    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'brain' }, async $ => {
    await update($, vitals, v => ({ ...v, bootAt: Date.now() }))
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Neural Core online.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text : ''
    await update($, vitals, v => ({ ...v, turnStartedAt: Date.now(), waiting: undefined, loopWarned: undefined }))
    await update($, brain, b => {
      const spark: Spark = {
        id: `task-${Date.now()}`,
        region: 'core',
        kind: 'task',
        verb: 'New task',
        detail: oneLine(text, 120),
        isError: false,
        isDone: true,
        at: Date.now(),
      }
      return {
        ...b,
        mode: 'thinking' as Mode,
        counts: { ...b.counts, core: b.counts.core + 1 },
        feed: [...b.feed, spark].slice(-FEED_SIZE),
      }
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const region = regionOf(e.tool)
    const { verb, detail } = describe(e.tool, e as unknown as Record<string, unknown>)
    const id = e.tool_use_id
    const started = Date.now()
    await update($, brain, b => ({
      ...b,
      mode: 'acting' as Mode,
      total: b.total + 1,
      counts: { ...b.counts, [region]: b.counts[region] + 1 },
      feed: [
        ...b.feed,
        { id, region, verb, detail: oneLine(detail, 300), isError: false, isDone: false, at: started },
      ].slice(-FEED_SIZE),
    }))
    await patchVitals($, v => (v.waiting && v.waiting.id !== id ? { ...v, waiting: undefined } : v))
    const ran = await next(e)
    await patchVitals($, v => (v.waiting?.id === id ? { ...v, waiting: undefined } : v))
    const failed = 'deny' in ran && ran.deny !== undefined ? true : ran.isError === true
    const after = await update($, brain, b => ({
      ...b,
      mode: 'thinking' as Mode,
      errors: b.errors + (failed ? 1 : 0),
      feed: b.feed.map(s =>
        s.id === id ? { ...s, isDone: true, isError: failed, ms: Date.now() - started, at: failed ? Date.now() : s.at } : s,
      ),
    }))
    const loop = loopIn(after.feed)
    if (loop && (await read($, vitals)).loopWarned !== loop) {
      await update($, vitals, v => ({ ...v, loopWarned: loop }))
      $.ui.toast(`Possible loop: Claude keeps repeating "${loop}". You may want to step in.`)
      await chime($, 'alert')
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const ended = Date.now()
    const v = await update($, vitals, x => ({
      ...x,
      waiting: undefined,
      busyMs: (x.busyMs ?? 0) + (x.turnStartedAt ? ended - x.turnStartedAt : 0),
    }))
    const ms = v.turnStartedAt ? ended - v.turnStartedAt : 0
    await update($, brain, b => {
      const summary = summarize(b.feed)
      const card: Spark[] = summary
        ? [{ id: `sum-${Date.now()}`, region: 'core', kind: 'summary', verb: 'Task complete', detail: '', isError: false, isDone: true, at: Date.now(), ms: ms || undefined, summary }]
        : []
      return { ...b, mode: 'idle' as Mode, feed: [...b.feed, ...card].slice(-FEED_SIZE) }
    })
    if (ms >= LONG_TASK_MS) {
      $.ui.toast(`Done in ${took(ms)}.`)
      await chime($, 'done')
    }
    await saveTotals($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const b = await read($, brain)
    const v = await read($, vitals)
    const loop = loopIn(b.feed)
    const mode = loop ? { text: 'LOOPING', color: RED } : v.waiting ? { text: 'WAITING ON YOU', color: HOT } : MODE[b.mode]
    const fiveHour = v.limits.find(l => l.kind === 'five_hour')
    const week = v.limits.find(l => l.kind === 'seven_day')
    const gaugeColor = (pct: number | undefined) => (pct === undefined ? undefined : pct >= 90 ? RED : pct >= 70 ? WARN : AMBER)
    const pctText = (pct: number | undefined) => (pct === undefined ? '--' : `${Math.round(pct)}%`)
    const toggleSound = () => update($, vitals, x => ({ ...x, isMuted: !x.isMuted }))
    const toggleCalm = () => update($, vitals, x => ({ ...x, isCalm: !x.isCalm }))
    // Helper agents still at work, for the satellites.
    const start = b.feed.map(isTask).lastIndexOf(true)
    const helpers = b.feed
      .slice(Math.max(0, start))
      .filter(s => s.region === 'swarm' && !s.isDone && /^Sent a helper/.test(s.verb))
      .map(s => s.detail || 'helper')
    const now = Date.now()
    const hist = await read($, history)
    const today = dayOf(now)
    const live = totalsOf(b, v)
    const days = { ...hist.days, [dayOf(b.startedAt)]: add(hist.days[dayOf(b.startedAt)] ?? ZERO, live) }
    const series = lastDays(days, 14, now)
    const last7 = series.slice(-7).reduce((sum, d) => add(sum, d.t), ZERO)
    const lifetime = Object.values(days).reduce((sum, t) => add(sum, t), ZERO)
    const todayT = days[today] ?? ZERO
    const totalsLine = (t: typeof ZERO) =>
      `${t.actions} actions · ${t.tasks} tasks · ${t.edits} edits · ${t.errors} errors · ${took(t.busyMs) || '0s'} busy${t.costUsd > 0 ? ` · $${t.costUsd.toFixed(2)}` : ''}`
    const vw = await read($, view)
    const rows = buildRows(b.feed, vw.filter, SHOWN)
    const status = (items: Spark[]) => {
      const s = items[items.length - 1]!
      if (!s.isDone) return { text: '● live', color: AMBER }
      if (s.isError) return { text: '✖ failed', color: RED }
      const ms = items.reduce((sum, x) => sum + (x.ms ?? 0), 0)
      return { text: took(ms), color: undefined }
    }
    const toggle = (key: string) =>
      update($, view, x => ({
        ...x,
        expanded: x.expanded.includes(key) ? x.expanded.filter(k => k !== key) : [...x.expanded, key].slice(-20),
      }))
    const setFilter = (filter: string) => update($, view, x => ({ ...x, filter }))
    const filters = [
      { id: 'all', name: 'ALL', n: b.total, color: AMBER },
      { id: 'errors', name: 'ERRORS', n: b.errors, color: RED },
      ...LOBES.map(l => ({ id: l.id as string, name: l.name, n: b.counts[l.id], color: TAG[l.id].color })),
    ]
    const filterName = filters.find(x => x.id === vw.filter)?.name ?? 'ALL'
    const tagOf = (s: Spark) => TAG[s.region]
    const stats = `${b.total} actions · ${b.errors} ${b.errors === 1 ? 'error' : 'errors'} · online ${uptime(b.startedAt)}`

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold color={AMBER}>◉ NEURAL CORE <Text color={mode.color}>· {mode.text}</Text></Text>
          <Text dimColor>{stats}</Text>
          <Text>
            <Text color={gaugeColor(v.contextPct)}>MEMORY {pctText(v.contextPct)}</Text>
            <Text dimColor> · </Text>
            <Text color={gaugeColor(fiveHour?.pct)}>5H {pctText(fiveHour?.pct)}</Text>
            {week && <Text dimColor> · WEEK {pctText(week.pct)}</Text>}
            {v.costUsd !== undefined && <Text dimColor> · ${v.costUsd.toFixed(2)}</Text>}
          </Text>
          {loop && <Text color={RED} bold>⚠ Possible loop: {loop}</Text>}
          {!loop && v.waiting && <Text color={HOT} bold>⏳ Waiting for your OK: {v.waiting.what}</Text>}
          <Text> </Text>
          {rows.length === 0 && <Text dimColor>No activity yet.</Text>}
          {rows.map((row: Row) => {
            if (row.kind === 'task')
              return (
                <Text color={AMBER} bold>
                  ▸ NEW TASK {clock(row.s.at)} <Text dimColor>{short(row.s.detail, 70)}</Text>
                </Text>
              )
            if (row.kind === 'summary')
              return (
                <Text color={HOT}>
                  ✓ TASK COMPLETE {took(row.s.ms)}{' '}
                  <Text dimColor>
                    · {row.s.summary?.steps} steps · {row.s.summary?.files.length} files changed · {row.s.summary?.errors} errors
                  </Text>
                </Text>
              )
            if (row.kind === 'compact')
              return (
                <Text color={HOT}>
                  ⟲ MEMORY COMPACTED <Text dimColor>{kTokens(row.s.tokens?.before)} → {kTokens(row.s.tokens?.after)}</Text>
                </Text>
              )
            const line = headline(row.items)
            const first = row.items[0]!
            return (
              <Text>
                <Text color={row.items.some(x => x.isError) ? RED : tagOf(first).color}>{tagOf(first).name.padEnd(7)}</Text>
                {line.verb} <Text dimColor>{short(line.detail, 60)}</Text>{' '}
                <Text color={status(row.items).color} dimColor={!status(row.items).color}>{status(row.items).text}</Text>
              </Text>
            )
          })}
          <Text> </Text>
          <Text color={AMBER} bold>HISTORY <Text dimColor>{sparkline(series)} last 14 days</Text></Text>
          <Text dimColor>Today: {totalsLine(todayT)}</Text>
          <Text dimColor>7 days: {totalsLine(last7)}</Text>
          <Text dimColor>All time: {lifetime.actions} actions · {lifetime.tasks} tasks</Text>
        </Box>
      )
    }

    const surface = $.ui.resolve(e)
    const { Box, Text, Svg, Button } = surface
    const Select = 'Select' in surface ? surface.Select : undefined
    const num = (n: number) => n.toLocaleString('en-US')
    const money = (n: number | undefined) => (n === undefined ? '--' : `$${n.toFixed(2)}`)
    const hasError = (items: Spark[]) => items.some(x => x.isError)
    const tile = (label: string, value: string, sub: string, color: string | undefined) => (
      <Box flexDirection="column" width="50%" flexShrink={1} minWidth={0} borderStyle="round" borderColor={LINE} paddingX={1}>
        <Text size="caption" dimColor wrap="truncate">{label}</Text>
        <Text size="heading" weight="semibold" tabular color={color} dimColor={!color} wrap="truncate">{value}</Text>
        <Text size="caption" dimColor wrap="truncate">{sub || ' '}</Text>
      </Box>
    )
    const section = (title: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        <Text size="caption" weight="semibold" color={AMBER}>{title}</Text>
        {right}
      </Box>
    )
    const callout = (title: string, color: string, lines: string[]) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} minWidth={0}>
        <Text size="caption" weight="bold" color={color}>{title}</Text>
        {lines.map(l => (
          <Text size="footnote" wrap="truncate">{l}</Text>
        ))}
      </Box>
    )
    const tableRow = (label: string, a: string, b: string, isHead = false) => (
      <Box flexDirection="row" columnGap={1}>
        <Box width="40%" minWidth={0}>
          <Text size="caption" dimColor={!isHead} weight={isHead ? 'semibold' : 'regular'} color={isHead ? AMBER : undefined} wrap="truncate">{label}</Text>
        </Box>
        <Box width="30%" minWidth={0} alignItems="flex-end">
          <Text size="caption" tabular weight={isHead ? 'semibold' : 'medium'} color={isHead ? AMBER : undefined} wrap="truncate">{a}</Text>
        </Box>
        <Box width="30%" minWidth={0} alignItems="flex-end">
          <Text size="caption" tabular weight={isHead ? 'semibold' : 'regular'} color={isHead ? AMBER : undefined} dimColor={!isHead} wrap="truncate">{b}</Text>
        </Box>
      </Box>
    )
    const filterOptions = filters
      .filter(fl => fl.id === 'all' || fl.id === vw.filter || fl.n > 0)
      .map(fl => ({ value: fl.id, label: `${fl.id === 'all' ? 'All activity' : fl.id === 'errors' ? 'Errors' : fl.name.charAt(0) + fl.name.slice(1).toLowerCase()} (${fl.n})` }))

    return (
      <Box flexDirection="column" gap={1} minWidth={0} overflow="hidden">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
          <Text weight="bold" color={AMBER} wrap="truncate">NEURAL CORE</Text>
          <Text size="caption" weight="bold" color="#1a0700" backgroundColor={mode.color}>{` ${mode.text} `}</Text>
        </Box>

        <Box flexDirection="row" columnGap={1}>
          {tile('MEMORY', pctText(v.contextPct), v.contextTokens !== undefined && v.contextWindow ? `${kTokens(v.contextTokens)} of ${kTokens(v.contextWindow)}` : 'no reading yet', gaugeColor(v.contextPct))}
          {tile('5-HOUR LIMIT', pctText(fiveHour?.pct), fiveHour?.resetsAt ? untilReset(fiveHour.resetsAt, now) : 'no reading yet', gaugeColor(fiveHour?.pct))}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {tile('WEEKLY LIMIT', pctText(week?.pct), week?.resetsAt ? untilReset(week.resetsAt, now) : week ? ' ' : 'no reading yet', gaugeColor(week?.pct))}
          {tile('SESSION', money(v.costUsd), `${num(b.total)} actions · ${uptime(b.startedAt)}`, v.costUsd === undefined ? undefined : PALE)}
        </Box>

        {loop && callout('POSSIBLE LOOP', RED, [`Repeating: ${loop}`, 'No changes between attempts. You may want to step in.'])}
        {!loop && v.waiting && callout('WAITING FOR YOUR OK', HOT, [v.waiting.what])}
        {helpers.length > 0 &&
          callout(`${helpers.length} HELPER${helpers.length === 1 ? '' : 'S'} AT WORK`, TAG.swarm.color, helpers.slice(0, 4))}

        <Box flexDirection="column" alignItems="center" gap={1} minWidth={0}>
          <Svg
            source={drawBrain(b, now, {
              vitals: v,
              loop,
              calm: v.isCalm,
              bootAge: v.bootAt ? now - v.bootAt : undefined,
              helpers,
            })}
            alt={`Holographic brain, ${mode.text.toLowerCase()}: ${LOBES.map(l => `${l.name} ${b.counts[l.id]}`).join(', ')}.`}
            isInteractive
          />
          <Box flexDirection="row" flexWrap="wrap" justifyContent="center" alignItems="center" columnGap={1} rowGap={1}>
            <Button key="sound" label={v.isMuted ? 'Sound off' : 'Sound on'} onPress={toggleSound} />
            <Button key="calm" label={v.isCalm ? 'Calm on' : 'Calm off'} onPress={toggleCalm} />
          </Box>
          <Text size="caption" dimColor wrap="truncate">Hover a region to inspect it. Click to fire it.</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1} paddingY={1} gap={1} minWidth={0}>
          {section(
            'ACTIVITY',
            Select ? (
              <Select key="filter" options={filterOptions} value={vw.filter} onSelect={(value: string) => setFilter(value)} />
            ) : (
              <Text size="caption" dimColor>{filterName === 'ALL' ? 'newest first' : filterName}</Text>
            ),
          )}

          {rows.length === 0 && (
            <Text size="footnote" dimColor>
              {vw.filter === 'all' ? 'Nothing yet. Activity appears here as Claude works.' : 'Nothing matches this filter yet.'}
            </Text>
          )}
          {rows.map((row: Row, index: number) => {
            if (row.kind === 'task')
              return (
                <Box flexDirection="column" marginTop={index === 0 ? 0 : 1} minWidth={0}>
                  <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                    <Text size="caption" weight="bold" color={AMBER}>TASK</Text>
                    <Text size="caption" tabular dimColor>{clock(row.s.at)}</Text>
                  </Box>
                  {row.s.detail !== '' && <Text size="footnote" italic dimColor wrap="truncate">{row.s.detail}</Text>}
                </Box>
              )
            if (row.kind === 'summary') {
              const sum = row.s.summary
              return (
                <Box flexDirection="column" minWidth={0}>
                  <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                    <Text size="caption" weight="bold" color={HOT}>✓ COMPLETE</Text>
                    <Text size="caption" tabular dimColor>{row.s.ms ? took(row.s.ms) : clock(row.s.at)}</Text>
                  </Box>
                  <Text size="caption" dimColor wrap="truncate">
                    {sum?.steps ?? 0} steps · {sum?.files.length ?? 0} files changed · {sum?.errors ?? 0} {sum?.errors === 1 ? 'error' : 'errors'}
                  </Text>
                  {sum && sum.files.length > 0 && <Text size="caption" mono color={PALE} wrap="truncate">{sum.files.join(', ')}</Text>}
                </Box>
              )
            }
            if (row.kind === 'compact')
              return (
                <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
                  <Text size="caption" weight="bold" color={HOT} wrap="truncate">
                    MEMORY COMPACTED{row.s.tokens?.before !== undefined ? ` · ${kTokens(row.s.tokens.before)} → ${kTokens(row.s.tokens.after)}` : ''}
                  </Text>
                  <Text size="caption" tabular dimColor>{clock(row.s.at)}</Text>
                </Box>
              )
            const first = row.items[0]!
            const line = headline(row.items)
            const isOpen = vw.expanded.includes(row.key)
            const isNewest = index === rows.findIndex(r => r.kind === 'step')
            const st = status(row.items)
            const tagColor = hasError(row.items) ? RED : tagOf(first).color
            return (
              <Box flexDirection="column" minWidth={0}>
                <Box flexDirection="row" alignItems="center" columnGap={1} minWidth={0}>
                  <Button key={`r-${row.key}`} plain onPress={() => toggle(row.key)}>
                    <Text size="caption" mono weight="semibold" color={isNewest ? '#1a0700' : tagColor} backgroundColor={isNewest ? tagColor : undefined}>
                      {`${isOpen ? '▾' : '▸'} ${tagOf(first).name.padEnd(6)}`}
                    </Text>
                  </Button>
                  <Box flexDirection="row" columnGap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Box flexShrink={0}>
                      <Text size="footnote" weight="medium" wrap="truncate">{line.verb}</Text>
                    </Box>
                    {line.detail !== '' && (
                      <Box flexShrink={1} minWidth={0} overflow="hidden">
                        <Text size="footnote" mono dimColor wrap="truncate">{line.detail}</Text>
                      </Box>
                    )}
                  </Box>
                  <Text size="caption" tabular color={st.color} dimColor={!st.color}>{st.text}</Text>
                </Box>
                {isOpen && (
                  <Box flexDirection="column" paddingLeft={2} marginTop={1} marginBottom={1} minWidth={0}>
                    {row.items.map(x => (
                      <Box flexDirection="row" columnGap={1} minWidth={0}>
                        <Text size="caption" tabular dimColor>{clock(x.at, true)}</Text>
                        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                          <Text size="caption" mono color={x.isError ? RED : PALE} wrap="truncate-middle">
                            {x.detail || x.verb}
                          </Text>
                        </Box>
                        <Text size="caption" tabular color={x.isError ? RED : undefined} dimColor={!x.isError}>
                          {x.isError ? 'failed' : x.isDone ? took(x.ms) : 'live'}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor={LINE} paddingX={1} paddingY={1} gap={1} minWidth={0}>
          {section('HISTORY', <Text size="caption" tabular dimColor wrap="truncate">{num(lifetime.actions)} actions all time</Text>)}
          <Box flexDirection="column" alignItems="center">
            <Svg source={chartSvg(series)} alt={`Actions per day, last 14 days: ${series.map(d => d.t.actions).join(', ')}.`} />
          </Box>
          <Box flexDirection="column">
            {tableRow('', 'TODAY', '7 DAYS', true)}
            {tableRow('Actions', num(todayT.actions), num(last7.actions))}
            {tableRow('Tasks', num(todayT.tasks), num(last7.tasks))}
            {tableRow('Files edited', num(todayT.edits), num(last7.edits))}
            {tableRow('Errors', num(todayT.errors), num(last7.errors))}
            {tableRow('Time working', took(todayT.busyMs) || '0s', took(last7.busyMs) || '0s')}
            {tableRow('Cost', money(todayT.costUsd), money(last7.costUsd))}
          </Box>
        </Box>
      </Box>
    )
  })
}
