export type Region = 'see' | 'build' | 'exec' | 'search' | 'swarm' | 'link' | 'core'
export type Mode = 'idle' | 'thinking' | 'acting'
// One entry in the thought stream: a tool call, or (region 'core') a marker:
// a new task (`kind` absent or 'task'), a finished task's summary, or a
// memory compaction.
export type Spark = {
  id: string
  region: Region
  verb: string
  detail: string
  isError: boolean
  isDone: boolean
  at: number
  ms?: number
  kind?: 'task' | 'summary' | 'compact'
  summary?: { steps: number; files: string[]; errors: number }
  tokens?: { before?: number; after?: number }
}
// What the stream shows: a filter ('all', 'errors' or a region) and the rows
// opened to show their detail.
// `isSettingsOpen`: the settings shown, opened from the cog.
export type View = { filter: string; expanded: string[]; isSettingsOpen?: boolean }
export type Brain = {
  counts: Record<Region, number>
  feed: Spark[]
  total: number
  errors: number
  startedAt: number
  mode: Mode
}

// A usage-limit window: `five_hour`, `seven_day`, or a gateway's `spend_limit`.
export type Limit = { kind: string; pct: number; resetsAt?: string }
// The session's vital signs and the alerts raised from them.
export type Vitals = {
  contextPct?: number
  contextTokens?: number
  contextWindow?: number
  limits: Limit[]
  costUsd?: number
  // A permission prompt waiting on the person.
  waiting?: { id: string; what: string; since: number }
  turnStartedAt?: number
  // The repeated action a loop warning was last raised for, so it fires once.
  loopWarned?: string
  isMuted: boolean
  // Calm mode: slower, stiller motion.
  isCalm?: boolean
  // The spoken updates, on unless switched off, and the line being spoken now.
  isVoiceOff?: boolean
  // The system voice the brain speaks with, by name; absent, the default (VOICES[0]).
  voice?: string
  // No welcome-back greeting when on.
  isGreetingOff?: boolean
  // When the app last left this chat, for the welcome back on return.
  leftAt?: number
  // The good English voices this Mac has, found at start: Daniel, Samantha and
  // any Enhanced or Premium voice downloaded in System Settings.
  voices?: { name: string; what: string }[]
  speaking?: { text: string; at: number }
  // When the panel last opened, for the boot sequence.
  bootAt?: number
  // This session's key in the cross-session store, and its time spent working.
  sessionKey?: string
  busyMs?: number
}

// One session's running totals, as saved in the store under `s:<key>`.
export type Totals = { actions: number; errors: number; tasks: number; edits: number; costUsd: number; busyMs: number }
export type SessionRecord = Totals & { day: string }
// Earlier sessions' totals by local day (YYYY-MM-DD), read at session start.
export type History = { days: Record<string, Totals> }

declare module 'claude-code' {
  interface PluginState {
    'neural-core': { brain: Shaped<Brain>; vitals: Shaped<Vitals>; view: Shaped<View>; history: Shaped<History> }
  }
}
