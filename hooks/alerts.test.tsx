import { expect, mock, test } from 'claude-code/testing'

// The approval reminder fires only for a permission dialog still open after a
// while, never for an ask auto mode settled or a call already running; the
// loop warning only for the exact same call answered the same way.

const base = (on: Parameters<Parameters<typeof test>[1]>[1], said: string[], toasts: string[]) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('audio.play', () => ({ value: undefined }))
  on('classic.PermissionRequest', () => ({}))
  on('audio.speak', (_, e) => {
    said.push(e.text)
    return { value: { via: 'system' as const } }
  })
}

test('a permission dialog left open reminds you once', async ($, on) => {
  const said: string[] = [], toasts: string[] = []
  const clock = mock.clock(on)
  base(on, said, toasts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm run deploy' } })
  await clock.advance(5000)
  expect(said).toEqual([])
  await clock.advance(1500)
  expect(said).toEqual(['Claude needs your approval.'])
  expect(toasts.some(t => /needs your OK/.test(t))).toBe(true)
})

test('a dialog you answered stays quiet while the command keeps running', async ($, on) => {
  const said: string[] = [], toasts: string[] = []
  const clock = mock.clock(on)
  base(on, said, toasts)
  let callId = ''
  let finish = () => {}
  on('tool.call', (_, e) => {
    callId = e.tool_use_id
    return new Promise(done => (finish = () => done({ result: {} })))
  })
  on('ui.render', { component: 'ToolProgress' }, ($t, e) => {
    const { Text } = $t.ui.resolve(e)
    return <Text>(ctrl+b to run in background)</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const call = $.tool.call({ tool: 'Bash', command: 'npm install' })
  await clock.advance(0)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm install' } })
  await clock.advance(1000)
  // Approved: the command is now running and shows its run-in-background hint.
  await $.ui.render({ surface: 'desktop', component: 'ToolProgress', requestId: callId, props: { tool_use_id: callId, kind: 'background_hint', hint: '(ctrl+b to run in background)' } })
  await clock.advance(20000)
  expect(said).toEqual([])
  expect(toasts.some(t => /needs your OK/.test(t))).toBe(false)
  finish()
  await call
})

test('an ask with no dialog (auto mode settled it) never reminds you', async ($, on) => {
  const said: string[] = [], toasts: string[] = []
  const clock = mock.clock(on)
  base(on, said, toasts)
  let finish = () => {}
  on('tool.call', () => new Promise(done => (finish = () => done({ result: {} }))))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const call = $.tool.call({ tool: 'Bash', command: 'npm run build' })
  await clock.advance(30000)
  expect(said).toEqual([])
  finish()
  await call
})

test('a file read in chunks or a poll whose output changes is not a loop', async ($, on) => {
  const said: string[] = [], toasts: string[] = []
  base(on, said, toasts)
  let n = 0
  on('tool.call', () => ({ result: {}, text: `status ${n++}` }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const offset of [1, 200, 400, 600]) await $.tool.call({ tool: 'Read', file_path: '/a/big.ts', offset, limit: 200 })
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Bash', command: 'gh run view 42' })
  expect(toasts.some(t => /loop/i.test(t))).toBe(false)
  expect(said).toEqual([])
})

test('the same call answered the same way three times is a loop', async ($, on) => {
  const said: string[] = [], toasts: string[] = []
  base(on, said, toasts)
  on('tool.call', () => ({ isError: true as const, result: 'FAIL', text: '1 test failed: expected 2, got 3' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(toasts.some(t => /loop/i.test(t))).toBe(true)
})
