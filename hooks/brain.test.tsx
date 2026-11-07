import { expect, test } from 'claude-code/testing'

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

test('tool calls show as plain-English steps on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/register.tsx', old_string: 'x', new_string: 'y' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Edited/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /register\.tsx/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 actions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /HISTORY|History/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a repeated action with no edits between is flagged as a loop', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Possible loop/i })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Looping/ })).toBeDefined()
  await ui.unmount()
})

test('running tests again after an edit is progress, not a loop', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/x.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Possible loop/i })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Memory/ })).toBeDefined()
  await ui.unmount()
})

test('voice, sound and calm switch from their settings', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const label = async (key: string) => (await ui.find({ type: 'Button', key }))?.text
  expect(await label('voice')).toBe('On')
  expect(await label('sound')).toBe('On')
  expect(await label('calm')).toBe('Off')
  await ui.press({ key: 'calm' })
  await ui.press({ key: 'sound' })
  await ui.press({ key: 'voice' })
  expect(await label('calm')).toBe('On')
  expect(await label('sound')).toBe('Off')
  expect(await label('voice')).toBe('Off')
  await ui.unmount()
})

test('the brain says when a task is done, and shows what it says', async ($, on) => {
  const said: string[] = []
  let finish = () => {}
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('audio.speak', (_, e) => {
    said.push(e.text)
    return new Promise(done => (finish = () => done({ value: { via: 'system' as const } })))
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'fix the tests' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/x.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'Fixed.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

  expect(said[0]).toMatch(/^Done.*1 step, 1 file changed\.$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Speaking/ })).toBeDefined()
  finish()
  await ui.unmount()
})

test('switching back to a chat fetches fresh stats', async ($, on) => {
  let pct = 40
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.usage', () => ({
    value: { context: { tokens: pct * 1000, window: 100000, percent: pct }, rateLimits: [{ kind: 'five_hour', percentUsed: pct + 10 }] },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /40% used/ })).toBeDefined()

  pct = 75
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(await ui.find({ type: 'Text', text: /75% used/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /85% used/ })).toBeDefined()
  await ui.unmount()
})
