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
    expect(await ui.find({ type: 'Text', text: /HISTORY/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /POSSIBLE LOOP/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /LOOPING/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /POSSIBLE LOOP/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /MEMORY/ })).toBeDefined()
  await ui.unmount()
})

test('calm mode and sound toggle from their buttons', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /Calm off/ })).toBeDefined()
  await ui.press({ key: 'calm' })
  expect(await ui.find({ type: 'Button', text: /Calm on/ })).toBeDefined()
  await ui.press({ key: 'sound' })
  expect(await ui.find({ type: 'Button', text: /Sound off/ })).toBeDefined()
  await ui.unmount()
})
