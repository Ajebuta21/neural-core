import { expect, test } from 'claude-code/testing'

import type { Spark } from '../types'
import { buildRows, headline, summarize } from './stream'

const PANE = {
  plugin: 'neural-core',
  component: 'Pane',
  requestId: 'neural-core',
  props: {
    title: 'Neural Core',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

let n = 0
const step = (region: Spark['region'], verb: string, detail: string, isError = false): Spark => ({
  id: `s${n++}`, region, verb, detail, isError, isDone: true, at: 0, ms: 100,
})
const task = (): Spark => ({ id: `t${n++}`, region: 'core', kind: 'task', verb: 'New task', detail: 'fix it', isError: false, isDone: true, at: 0 })

test('consecutive steps of one kind fold into a row, a failure stands alone', async () => {
  const feed = [task(), step('see', 'Read', 'a.ts'), step('see', 'Read', 'b.ts'), step('see', 'Read', 'c.ts'), step('exec', 'Ran', 'npm test', true)]
  const rows = buildRows(feed, 'all', 30)
  expect(rows.length).toBe(3)
  const folded = rows[1]!
  expect(folded.kind).toBe('step')
  if (folded.kind === 'step') expect(headline(folded.items)).toEqual({ verb: 'Read 3 files', detail: 'a.ts, b.ts, c.ts' })
  expect(buildRows(feed, 'errors', 30).length).toBe(1)
  expect(buildRows(feed, 'see', 30).length).toBe(1)
})

test('the same file read again counts as repeats, not files', async () => {
  expect(headline([step('see', 'Read', 'a.ts'), step('see', 'Read', 'a.ts')])).toEqual({ verb: 'Read ×2', detail: 'a.ts' })
})

test('a summary counts steps, changed files and errors since the task began', async () => {
  const feed = [step('build', 'Edited', 'old.ts'), task(), step('build', 'Edited', 'x.ts'), step('build', 'Edited', 'x.ts'), step('build', 'Wrote', 'y.ts'), step('exec', 'Ran', 'tsc', true)]
  expect(summarize(feed)).toEqual({ steps: 4, files: ['x.ts', 'y.ts'], errors: 1 })
})

test('filter chips and row expanding work in the panel', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/p/b.ts' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Read 2 files/ })).toBeDefined()

  const rows = await ui.find({ type: 'Text', text: /npm run build/ })
  expect(rows).toBeDefined()
  await ui.press({ key: 'f-see' })
  expect(await ui.find({ type: 'Text', text: /SEE only/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /npm run build/ })).toBeUndefined()

  await ui.press({ key: 'f-all' })
  const row = await ui.find({ type: 'Button', text: /Read 2 files/ })
  expect(row?.key).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/p\/b\.ts|b\.ts/ })).toBeDefined()
  await ui.press({ key: row!.key! })
  expect(await ui.find({ type: 'Text', text: /▾/ })).toBeDefined()
  await ui.unmount()
})
