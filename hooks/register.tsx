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

// A task this long gets a "done" chime and a spoken line when it ends.
const LONG_TASK_MS = 60000
// A permission prompt still open after this long gets a toast and a ding.
const WAIT_ALERT_MS = 1500
const MEMORY_WARN_PCT = 80

// Only the brain is drawn in amber; the panel around it takes the theme's own
// colors, so it reads as part of the app.
const TAG: Record<Region, { name: string }> = {
  build: { name: 'BUILD' },
  exec: { name: 'EXEC' },
  link: { name: 'LINK' },
  see: { name: 'SEE' },
  search: { name: 'SEARCH' },
  swarm: { name: 'SWARM' },
  core: { name: 'TASK' },
}
const MODE: Record<Mode, { text: string; color?: string }> = {
  idle: { text: 'IDLE' },
  thinking: { text: 'THINKING' },
  acting: { text: 'EXECUTING' },
}

// A reading's theme color: warning from 70%, error from 90%.
const levelKey = (pct: number | undefined) => (pct === undefined ? undefined : pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined)

// Rules and meters in a mid grey that reads on a light or dark panel. The
// markup is wider than any pane, so the panel draws them at the pane's width.
const RULE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 3" width="1000" height="3" preserveAspectRatio="none"><rect width="1000" height="3" fill="#888" opacity=".22"/></svg>`
function meter(pct: number | undefined): string {
  const p = Math.max(0, Math.min(100, pct ?? 0))
  const fill = p >= 90 ? '#e5534b' : p >= 70 ? '#d9a23a' : '#a3a3a3'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 12" width="1000" height="12" preserveAspectRatio="none"><rect width="1000" height="12" fill="#888" opacity=".25"/><rect width="${Math.round(p * 10)}" height="12" fill="${fill}"/></svg>`
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
  const days = aggregate(records)
  if (JSON.stringify(days) !== JSON.stringify((await read($, history)).days)) await update($, history, () => ({ days }))
}

// When the stats were last fetched, so a redraw refetches them only when stale.
const REFRESH_MS = 20000
let refreshedAt = 0

// Fetch the live readings (memory, limits, cost) and other sessions' history
// again: the limits are shared with every chat, so a chat you switch back to
// would otherwise show what they were when it last ran. Writes only changes.
async function refresh($: EngineInterface) {
  refreshedAt = Date.now()
  try {
    const u = await $.session.usage()
    await patchVitals($, v => withUsage(v, u))
  } catch {
    // No reading yet: the gauges show "--" until the first one.
  }
  const key = (await read($, vitals)).sessionKey
  if (key) await loadHistory($, key).catch(() => undefined)
}

// Write the vital signs only when they change: every write redraws the panel.
async function patchVitals($: EngineInterface, change: (v: Vitals) => Vitals): Promise<Vitals> {
  const before = await read($, vitals)
  const after = change(before)
  if (after === before || JSON.stringify(after) === JSON.stringify(before)) return before
  return update($, vitals, change)
}

// The brain speaks only for what matters: Claude needs you, a loop, memory
// filling up, a long task done. The same line is never repeated within a
// minute, and nothing but an approval request follows another within 10 seconds.
const QUIET_MS = 10000
const REPEAT_MS = 60000
let lastSaid = { text: '', at: 0 }

// A chime, then the brain says the words: each only while switched on. Run
// without awaiting it, so no hook waits on the speakers.
async function announce($: EngineInterface, sound: 'done' | 'ping' | 'alert' | undefined, words?: string, isUrgent = false) {
  const v = await read($, vitals)
  if (sound && !v.isMuted) await $.audio.play({ asset: `sounds/${sound}.wav` }).catch(() => undefined)
  if (!words || v.isVoiceOff) return
  const now = Date.now()
  if (words === lastSaid.text && now - lastSaid.at < REPEAT_MS) return
  if (!isUrgent && now - lastSaid.at < QUIET_MS) return
  lastSaid = { text: words, at: now }
  await speak($, words, voiceOf(v))
}

// Used when this Mac's voices can't be listed: both ship with every Mac.
const BUILT_IN = [
  { name: 'Daniel', what: 'British' },
  { name: 'Samantha', what: 'American' },
]
const ACCENT: Record<string, string> = {
  en_US: 'American', en_GB: 'British', en_AU: 'Australian', en_IE: 'Irish', en_IN: 'Indian', en_ZA: 'South African', en_SC: 'Scottish', en_NZ: 'New Zealand',
}
const isPremium = (name: string) => /\((Enhanced|Premium)\)/.test(name)

// The chosen voice, else the best one installed: a Premium or Enhanced voice
// before plain Daniel.
const voiceOf = (v: Vitals) =>
  v.voice ?? (v.voices ?? []).find(x => /Premium/.test(x.name))?.name ?? (v.voices ?? []).find(x => isPremium(x.name))?.name ?? 'Daniel'

// List this Mac's good English voices: Daniel, Samantha, and every Enhanced or
// Premium voice (the natural-sounding ones you download in System Settings).
async function findVoices($: EngineInterface) {
  try {
    const { stdout } = await $.process.run(['say', '-v', '?'], { timeoutMs: 5000 })
    const found = stdout
      .split('\n')
      .map(line => line.match(/^(.+?)\s+(en_[A-Z]{2})\s+#/))
      .filter((m): m is RegExpMatchArray => !!m)
      .filter(m => isPremium(m[1]!) || /^(Daniel|Samantha)$/.test(m[1]!))
      .map(m => ({ name: m[1]!.trim(), what: ACCENT[m[2]!] ?? m[2]! }))
      .sort((a, b) => Number(isPremium(b.name)) - Number(isPremium(a.name)))
    if (found.length > 0) await patchVitals($, v => ({ ...v, voices: found }))
  } catch {
    // Not a Mac, or `say` is missing: the built-in pair stands.
  }
}

// Say the words in `voice`, showing them under the brain while it talks.
async function speak($: EngineInterface, words: string, voice: string) {
  const at = Date.now()
  await update($, vitals, x => ({ ...x, speaking: { text: words, at } }))
  await $.audio.speak(words, { voice }).catch(() => $.audio.speak(words).catch(() => undefined))
  await patchVitals($, x => (x.speaking?.at === at ? { ...x, speaking: undefined } : x))
}

// A duration as it is said aloud: "42 seconds", "3 minutes".
function spoken(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.round(s / 60)
  return `${m} minute${m === 1 ? '' : 's'}`
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

// The latest task in any chat, kept in the store so a new chat can say where
// you stopped.
type LastTask = { text: string; at: number; isDone: boolean; files: number; errors: number }
const LAST_KEY = 'last-task'
// Away this long, the brain greets you when you come back.
const AWAY_MS = 20 * 60000

function ago(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 24) return h === 1 ? 'about an hour ago' : `about ${h} hours ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

// "Good evening. Welcome back. Last time, about 3 hours ago, you were working
// on: fix the login bug. Claude finished it, with 2 files changed."
function greeting(t: LastTask | undefined, isWaiting: boolean, now: number): string {
  const hour = new Date(now).getHours()
  const hello = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}. Welcome back.`
  if (!t || !t.text) return hello
  const words = t.text.replace(/https?:\/\/\S+/g, 'a link').replace(/[`*_#>]/g, '').split(/\s+/).filter(Boolean)
  const what = words.slice(0, 14).join(' ') + (words.length > 14 ? '…' : '')
  const outcome = isWaiting
    ? 'Claude is waiting for your approval.'
    : !t.isDone
      ? 'It was still in progress.'
      : t.errors > 0
        ? `It ended with ${t.errors} error${t.errors === 1 ? '' : 's'}.`
        : t.files > 0
          ? `Claude finished it, with ${t.files} file${t.files === 1 ? '' : 's'} changed.`
          : 'Claude finished it.'
  return `${hello} Last time, ${ago(now - t.at)}, you were working on: ${what.replace(/[.!?]+$/, '')}. ${outcome}`
}

// Greet aloud, and as a toast so it reads with the voice off too.
async function greet($: EngineInterface, t: LastTask | undefined) {
  const v = await read($, vitals)
  if (v.isGreetingOff) return
  const words = greeting(t, !!v.waiting, Date.now())
  try {
    $.ui.toast(words, { timeoutMs: 10000 })
  } catch {
    // A surface with no toasts: the voice still says it.
  }
  await announce($, undefined, words, true)
}

// This chat's own latest task, from its feed.
function lastTaskIn(b: Brain): LastTask | undefined {
  const i = b.feed.map(isTask).lastIndexOf(true)
  if (i < 0) return undefined
  const after = b.feed.slice(i + 1)
  const sum = after.find(s => s.kind === 'summary')?.summary
  const last = b.feed[b.feed.length - 1]!
  return { text: b.feed[i]!.detail, at: last.at, isDone: b.mode === 'idle', files: sum?.files.length ?? 0, errors: sum?.errors ?? 0 }
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
    void $.ui.open({ id: PANE, title: TITLE })
    void findVoices($)
    if (v0.sessionKey) await refresh($)
    // A new chat after a while away: say where you stopped, in whichever chat.
    const last = (await $.store.get(LAST_KEY).catch(() => undefined)) as LastTask | undefined
    const own = lastTaskIn(await read($, brain))
    const since = Math.max(last?.at ?? 0, own?.at ?? 0)
    if (since > 0 && Date.now() - since >= AWAY_MS) void greet($, own ?? last)

    return next(e)
  })

  // The app connected to this chat, as when you switch to it or open the app:
  // fetch fresh stats, and after a while away, greet you with where you stopped.
  on('session.attach', async ($, e, next) => {
    void refresh($)
    const v = await read($, vitals)
    const b = await read($, brain)
    const own = lastTaskIn(b)
    const since = Math.max(v.leftAt ?? 0, own?.at ?? 0)
    if (v.leftAt !== undefined) await patchVitals($, x => ({ ...x, leftAt: undefined }))
    if (since > 0 && Date.now() - since >= AWAY_MS) void greet($, own)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.detach', async ($, e, next) => {
    await patchVitals($, x => ({ ...x, leftAt: Date.now() }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Fires whenever memory, limits or cost move.
  on('session.measure', async ($, e, next) => {
    const before = await read($, vitals)
    const after = await patchVitals($, v => withUsage(v, e))
    if ((before.contextPct ?? 0) < MEMORY_WARN_PCT && (after.contextPct ?? 0) >= MEMORY_WARN_PCT) {
      $.ui.toast(`Memory is ${after.contextPct}% full. Consider /compact or a fresh session soon.`)
      void announce($, 'alert', `Memory is ${Math.round(after.contextPct ?? 0)} percent full. Consider compacting.`)
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
          void announce($, 'ping', 'Claude needs your approval.', true)
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
    const task: LastTask = { text: oneLine(text, 200), at: Date.now(), isDone: false, files: 0, errors: 0 }
    await $.store.set(LAST_KEY, task).catch(() => undefined)
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
      void announce($, 'alert', 'Claude may be stuck in a loop. You may want to step in.')
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
    const summary = summarize((await read($, brain)).feed)
    await update($, brain, b => {
      const card: Spark[] = summary
        ? [{ id: `sum-${Date.now()}`, region: 'core', kind: 'summary', verb: 'Task complete', detail: '', isError: false, isDone: true, at: Date.now(), ms: ms || undefined, summary }]
        : []
      return { ...b, mode: 'idle' as Mode, feed: [...b.feed, ...card].slice(-FEED_SIZE) }
    })
    if (ms >= LONG_TASK_MS) $.ui.toast(`Done in ${took(ms)}.`)
    // Only a long task is announced: you have likely looked away by then.
    if (summary && ms >= LONG_TASK_MS) {
      const errors = summary.errors > 0 ? `, with ${summary.errors} error${summary.errors === 1 ? '' : 's'}` : ''
      void announce($, 'done', `Task finished in ${spoken(ms)}${errors}.`)
    }
    const last = (await $.store.get(LAST_KEY).catch(() => undefined)) as LastTask | undefined
    if (last) {
      const task: LastTask = { ...last, at: ended, isDone: true, files: summary?.files.length ?? 0, errors: summary?.errors ?? 0 }
      await $.store.set(LAST_KEY, task).catch(() => undefined)
    }
    await saveTotals($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (Date.now() - refreshedAt > REFRESH_MS) void refresh($)
    const b = await read($, brain)
    const v = await read($, vitals)
    const loop = loopIn(b.feed)
    const mode = loop ? { text: 'LOOPING', color: 'error' } : v.waiting ? { text: 'WAITING ON YOU', color: 'warning' } : MODE[b.mode]
    const fiveHour = v.limits.find(l => l.kind === 'five_hour')
    const week = v.limits.find(l => l.kind === 'seven_day')
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
      if (!s.isDone) return { text: 'Running', color: 'text' }
      if (s.isError) return { text: 'Failed', color: 'error' }
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
      { id: 'all', name: 'ALL', n: b.total },
      { id: 'errors', name: 'ERRORS', n: b.errors },
      ...LOBES.map(l => ({ id: l.id as string, name: l.name, n: b.counts[l.id] })),
    ]
    const filterName = filters.find(x => x.id === vw.filter)?.name ?? 'ALL'
    const tagOf = (s: Spark) => TAG[s.region]
    const stats = `${b.total} actions · ${b.errors} ${b.errors === 1 ? 'error' : 'errors'} · online ${uptime(b.startedAt)}`

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text bold>NEURAL CORE <Text color={mode.color} dimColor={!mode.color}>· {mode.text}</Text></Text>
          <Text dimColor>{stats}</Text>
          <Text>
            <Text color={levelKey(v.contextPct)}>MEMORY {pctText(v.contextPct)}</Text>
            <Text dimColor> · </Text>
            <Text color={levelKey(fiveHour?.pct)}>5H {pctText(fiveHour?.pct)}</Text>
            {week && <Text dimColor> · WEEK {pctText(week.pct)}</Text>}
            {v.costUsd !== undefined && <Text dimColor> · ${v.costUsd.toFixed(2)}</Text>}
          </Text>
          {loop && <Text color="error" bold>Possible loop: {loop}</Text>}
          {!loop && v.waiting && <Text color="warning" bold>Waiting for your OK: {v.waiting.what}</Text>}
          <Text> </Text>
          {rows.length === 0 && <Text dimColor>No activity yet.</Text>}
          {rows.map((row: Row) => {
            if (row.kind === 'task')
              return (
                <Text bold>
                  NEW TASK {clock(row.s.at)} <Text dimColor>{short(row.s.detail, 70)}</Text>
                </Text>
              )
            if (row.kind === 'summary')
              return (
                <Text color="success">
                  ✓ TASK COMPLETE {took(row.s.ms)}{' '}
                  <Text dimColor>
                    · {row.s.summary?.steps} steps · {row.s.summary?.files.length} files changed · {row.s.summary?.errors} errors
                  </Text>
                </Text>
              )
            if (row.kind === 'compact')
              return (
                <Text>
                  MEMORY COMPACTED <Text dimColor>{kTokens(row.s.tokens?.before)} → {kTokens(row.s.tokens?.after)}</Text>
                </Text>
              )
            const line = headline(row.items)
            const first = row.items[0]!
            return (
              <Text>
                <Text color={row.items.some(x => x.isError) ? 'error' : undefined} dimColor={!row.items.some(x => x.isError)}>{tagOf(first).name.padEnd(7)}</Text>
                {line.verb} <Text dimColor>{short(line.detail, 60)}</Text>{' '}
                <Text color={status(row.items).color} dimColor={!status(row.items).color}>{status(row.items).text}</Text>
              </Text>
            )
          })}
          <Text> </Text>
          <Text bold>HISTORY <Text dimColor>{sparkline(series)} last 14 days</Text></Text>
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
    // Opening settings looks for voices again, so one downloaded meanwhile shows.
    const toggleSettings = async () => {
      const after = await update($, view, x => ({ ...x, isSettingsOpen: !x.isSettingsOpen }))
      if (after.isSettingsOpen) void findVoices($)
    }
    const toggleGreeting = () => update($, vitals, x => ({ ...x, isGreetingOff: !x.isGreetingOff }))
    const toggleVoice = () => update($, vitals, x => ({ ...x, isVoiceOff: !x.isVoiceOff, speaking: undefined }))
    const voice = voiceOf(v)
    const voices = v.voices ?? BUILT_IN
    const options = (voices.some(x => x.name === voice) ? voices : [{ name: voice, what: 'chosen' }, ...voices]).map(x => ({
      value: x.name,
      label: `${x.name.replace(/ \((Enhanced|Premium)\)/, '')} · ${x.what}${isPremium(x.name) ? ', natural' : ''}`,
    }))
    const sample = (name: string) => speak($, `Hi, I'm ${name.replace(/ \(.*\)/, '')}. Task finished in 2 minutes.`, name)
    // Picking a voice plays it at once, so you hear it before you keep it.
    const pickVoice = async (name: string) => {
      await update($, vitals, x => ({ ...x, voice: name }))
      void sample(name)
    }
    // Thin rules and meters, drawn in a mid grey that reads on light and dark.
    const divider = <Svg source={RULE} alt="" />
    const heading = (title: string, right?: RenderChildren) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
        <Text weight="medium" wrap="truncate">{title}</Text>
        {right}
      </Box>
    )
    const pair = (label: string, value: string, color?: string) => (
      <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
        <Box flexShrink={1} minWidth={0}>
          <Text size="footnote" dimColor wrap="truncate">{label}</Text>
        </Box>
        <Text size="footnote" tabular color={color} dimColor={!color} wrap="truncate">{value}</Text>
      </Box>
    )
    const gauge = (label: string, pct: number | undefined, right: string) => (
      <Box flexDirection="column" gap="xs" minWidth={0}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1} minWidth={0}>
          <Box flexShrink={1} minWidth={0}>
            <Text size="footnote" wrap="truncate">
              {label} <Text color={levelKey(pct)} dimColor={!levelKey(pct)}>{pct === undefined ? '--' : `${Math.round(pct)}% used`}</Text>
            </Text>
          </Box>
          <Text size="footnote" tabular dimColor wrap="truncate">{right}</Text>
        </Box>
        <Svg source={meter(pct)} alt={`${label}: ${pct === undefined ? 'no reading' : `${Math.round(pct)}% used`}`} />
      </Box>
    )
    // A switch: a pill-shaped track with the knob at the right end when on.
    const switchFor = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
      <Button key={key} plain label={`${label}: ${isOn ? 'on' : 'off'}`} onPress={onPress}>
        <Text size="footnote" color="#ffffff" backgroundColor={isOn ? '#3b82f6' : '#6b6b6b'}>{isOn ? '   ● ' : ' ●   '}</Text>
      </Button>
    )
    const setting = (key: string, label: string, hint: string, isOn: boolean, onPress: () => unknown) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          <Text size="footnote" wrap="truncate">{label}</Text>
          <Text size="caption" dimColor wrap="truncate">{hint}</Text>
        </Box>
        {switchFor(key, label, isOn, onPress)}
      </Box>
    )
    const notice = (title: string, color: string, lines: string[]) => (
      <Box flexDirection="column" minWidth={0}>
        <Text size="footnote" weight="semibold" color={color} wrap="truncate">{title}</Text>
        {lines.map(l => (
          <Text size="footnote" dimColor wrap="truncate">{l}</Text>
        ))}
      </Box>
    )
    const tableRow = (label: string, a: string, b: string, isHead = false) => (
      <Box flexDirection="row" columnGap={1}>
        <Box width="44%" minWidth={0}>
          <Text size="footnote" dimColor wrap="truncate">{label}</Text>
        </Box>
        <Box width="28%" minWidth={0} alignItems="flex-end">
          <Text size={isHead ? 'caption' : 'footnote'} tabular dimColor={isHead} wrap="truncate">{a}</Text>
        </Box>
        <Box width="28%" minWidth={0} alignItems="flex-end">
          <Text size={isHead ? 'caption' : 'footnote'} tabular dimColor wrap="truncate">{b}</Text>
        </Box>
      </Box>
    )
    const filterOptions = filters
      .filter(fl => fl.id === 'all' || fl.id === vw.filter || fl.n > 0)
      .map(fl => ({ value: fl.id, label: `${fl.id === 'all' ? 'All activity' : fl.id === 'errors' ? 'Errors' : fl.name.charAt(0) + fl.name.slice(1).toLowerCase()} (${fl.n})` }))
    const stateText = loop ? 'Looping' : v.waiting ? 'Waiting on you' : v.speaking ? 'Speaking' : b.mode === 'acting' ? 'Working' : b.mode === 'thinking' ? 'Thinking' : 'Idle'
    const stateColor = loop ? 'error' : v.waiting ? 'warning' : undefined

    return (
      <Box flexDirection="column" gap={1} minWidth={0} overflow="hidden">
        <Svg
          source={drawBrain(b, now, {
            vitals: v,
            loop,
            calm: v.isCalm,
            bootAge: v.bootAt ? now - v.bootAt : undefined,
            helpers,
            speaking: v.speaking?.text,
          })}
          alt={`Holographic brain, ${stateText.toLowerCase()}: ${LOBES.map(l => `${l.name} ${b.counts[l.id]}`).join(', ')}. Hover a region to inspect it, click to fire it.`}
          isInteractive
        />
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
          <Box flexShrink={1} minWidth={0}>
            <Text size="footnote" weight="medium" color={stateColor} wrap="truncate">
              {stateText}
              <Text weight="regular" dimColor>{` · ${num(b.total)} ${b.total === 1 ? 'action' : 'actions'}`}</Text>
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            <Text size="footnote" tabular dimColor wrap="truncate">{`Online ${uptime(b.startedAt)}`}</Text>
            <Button key="settings" plain dimColor={!vw.isSettingsOpen} label={vw.isSettingsOpen ? 'Close settings' : 'Settings'} onPress={toggleSettings}>
              <Text size="body">⚙</Text>
            </Button>
          </Box>
        </Box>
        {v.speaking && (
          <Text size="footnote" italic dimColor wrap="truncate">{`“${v.speaking.text}”`}</Text>
        )}
        {loop && notice('Possible loop', 'error', [`Repeating: ${loop}`, 'No changes between attempts. You may want to step in.'])}
        {!loop && v.waiting && notice('Waiting for your OK', 'warning', [v.waiting.what])}
        {helpers.length > 0 && notice(`${helpers.length} helper${helpers.length === 1 ? '' : 's'} at work`, 'text', helpers.slice(0, 4))}
        {vw.isSettingsOpen && (
          <Box flexDirection="column" gap={1} minWidth={0}>
            {divider}
            {heading('Settings')}
            {setting('voice', 'Voice', 'Speaks when Claude needs you or a long task ends', !v.isVoiceOff, toggleVoice)}
            {Select && (
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} minWidth={0}>
                <Box flexGrow={1} flexShrink={1} minWidth={0}>
                  <Select
                    key="voice-pick"
                    options={options}
                    value={voice}
                    onSelect={(name: string) => pickVoice(name)}
                  />
                </Box>
                <Button key="voice-play" label="Play sample" onPress={() => sample(voice)} />
              </Box>
            )}
            {Select && !voices.some(x => isPremium(x.name)) && (
              <Text size="caption" dimColor>
                For a natural voice, download one in System Settings › Accessibility › Spoken Content › System voice › Manage Voices (pick an English voice marked Premium). It appears here when you next open settings.
              </Text>
            )}
            {setting('greeting', 'Welcome back', 'Says where you stopped after 20 minutes away', !v.isGreetingOff, toggleGreeting)}
            {setting('sound', 'Sound alerts', 'Chimes for prompts, loops and long tasks', !v.isMuted, toggleSound)}
            {setting('calm', 'Calm motion', 'Slower, stiller animation', !!v.isCalm, toggleCalm)}
          </Box>
        )}

        {divider}
        {heading('Usage')}
        {gauge('Memory', v.contextPct, v.contextTokens !== undefined && v.contextWindow ? `${kTokens(v.contextTokens)} / ${kTokens(v.contextWindow)}` : 'No reading yet')}
        {gauge('5-hour limit', fiveHour?.pct, fiveHour?.resetsAt ? untilReset(fiveHour.resetsAt, now) : fiveHour ? '' : 'No reading yet')}
        {gauge('Weekly limit', week?.pct, week?.resetsAt ? untilReset(week.resetsAt, now) : week ? '' : 'No reading yet')}
        {pair('Session cost', money(v.costUsd))}

        {divider}
        {heading(
          'Activity',
          Select ? (
            <Select key="filter" options={filterOptions} value={vw.filter} onSelect={(value: string) => setFilter(value)} />
          ) : (
            <Text size="footnote" dimColor>{filterName === 'ALL' ? 'Newest first' : filterName}</Text>
          ),
        )}
        {rows.length === 0 && (
          <Text size="footnote" dimColor>
            {vw.filter === 'all' ? 'Nothing yet. Activity appears here as Claude works.' : 'Nothing matches this filter yet.'}
          </Text>
        )}
        {rows.length > 0 && (
          <Box flexDirection="column" gap="xs" minWidth={0}>
            {rows.map((row: Row, index: number) => {
              if (row.kind === 'task')
                return (
                  <Box flexDirection="column" marginTop={index === 0 ? 0 : 1} minWidth={0}>
                    <Text size="caption" dimColor wrap="truncate">{`Task · ${clock(row.s.at)}`}</Text>
                    {row.s.detail !== '' && <Text size="footnote" wrap="truncate">{row.s.detail}</Text>}
                  </Box>
                )
              if (row.kind === 'summary') {
                const sum = row.s.summary
                const files = sum?.files.length ?? 0
                return (
                  <Box flexDirection="row" columnGap={1} minWidth={0}>
                    <Text size="footnote" color="success">✓</Text>
                    <Box flexShrink={1} minWidth={0}>
                      <Text size="footnote" dimColor wrap="truncate">
                        {`Done${row.s.ms ? ` in ${took(row.s.ms)}` : ''} · ${sum?.steps ?? 0} ${sum?.steps === 1 ? 'step' : 'steps'} · ${files} ${files === 1 ? 'file' : 'files'} changed${sum?.errors ? ` · ${sum.errors} ${sum.errors === 1 ? 'error' : 'errors'}` : ''}`}
                      </Text>
                    </Box>
                  </Box>
                )
              }
              if (row.kind === 'compact')
                return pair(
                  `Memory compacted${row.s.tokens?.before !== undefined ? ` · ${kTokens(row.s.tokens.before)} → ${kTokens(row.s.tokens.after)}` : ''}`,
                  clock(row.s.at),
                )
              const first = row.items[0]!
              const line = headline(row.items)
              const isOpen = vw.expanded.includes(row.key)
              const st = status(row.items)
              const failed = hasError(row.items)
              return (
                <Box flexDirection="column" minWidth={0}>
                  <Box flexDirection="row" alignItems="center" columnGap={1} minWidth={0}>
                    <Button key={`r-${row.key}`} plain dimColor onPress={() => toggle(row.key)}>
                      <Text size="footnote">{isOpen ? '⌄' : '›'}</Text>
                    </Button>
                    <Box flexDirection="row" columnGap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                      <Box flexShrink={0}>
                        <Text size="footnote" color={failed ? 'error' : undefined} wrap="truncate">{line.verb}</Text>
                      </Box>
                      {line.detail !== '' && (
                        <Box flexShrink={1} minWidth={0} overflow="hidden">
                          <Text size="footnote" mono dimColor wrap="truncate">{line.detail}</Text>
                        </Box>
                      )}
                    </Box>
                    <Box flexShrink={0}>
                      <Text size="caption" tabular color={st.color} dimColor={!st.color}>{st.text}</Text>
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box flexDirection="column" paddingLeft={2} marginTop="xs" marginBottom="xs" minWidth={0}>
                      <Text size="caption" dimColor>{TAG[first.region].name.charAt(0) + TAG[first.region].name.slice(1).toLowerCase()}</Text>
                      {row.items.map(x => (
                        <Box flexDirection="row" columnGap={1} minWidth={0}>
                          <Box flexShrink={0}>
                            <Text size="caption" tabular dimColor>{clock(x.at, true)}</Text>
                          </Box>
                          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                            <Text size="caption" mono color={x.isError ? 'error' : undefined} dimColor={!x.isError} wrap="truncate-middle">
                              {x.detail || x.verb}
                            </Text>
                          </Box>
                          <Box flexShrink={0}>
                            <Text size="caption" tabular color={x.isError ? 'error' : undefined} dimColor={!x.isError}>
                              {x.isError ? 'Failed' : x.isDone ? took(x.ms) : 'Running'}
                            </Text>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}

        {divider}
        {heading('History', <Text size="footnote" tabular dimColor wrap="truncate">{`${num(lifetime.actions)} actions all time`}</Text>)}
        <Svg source={chartSvg(series)} alt={`Actions per day, last 14 days: ${series.map(d => d.t.actions).join(', ')}.`} />
        <Box flexDirection="column" gap="xs">
          {tableRow('', 'Today', '7 days', true)}
          {tableRow('Actions', num(todayT.actions), num(last7.actions))}
          {tableRow('Tasks', num(todayT.tasks), num(last7.tasks))}
          {tableRow('Files edited', num(todayT.edits), num(last7.edits))}
          {tableRow('Errors', num(todayT.errors), num(last7.errors))}
          {tableRow('Time working', took(todayT.busyMs) || '0s', took(last7.busyMs) || '0s')}
          {tableRow('Cost', money(todayT.costUsd), money(last7.costUsd))}
        </Box>
      </Box>
    )
  })
}
