import { expect, test } from 'claude-code/testing'

import { aggregate, dayOf, isStale, lastDays, sparkline } from './history'

const rec = (day: string, actions: number) => ({ day, actions, errors: 1, tasks: 2, edits: 3, costUsd: 0.5, busyMs: 1000 })

test('sessions add up by day, malformed records are skipped', async () => {
  const days = aggregate([rec('2026-11-01', 10), rec('2026-11-01', 5), rec('2026-11-02', 7), { nope: true }, null])
  expect(days['2026-11-01']).toEqual({ actions: 15, errors: 2, tasks: 4, edits: 6, costUsd: 1, busyMs: 2000 })
  expect(days['2026-11-02']?.actions).toBe(7)
  expect(Object.keys(days).length).toBe(2)
})

test('the last 14 days end today and fill empty days with zero', async () => {
  const now = Date.parse('2026-11-07T15:00:00')
  const series = lastDays({ '2026-11-07': { actions: 8, errors: 0, tasks: 1, edits: 0, costUsd: 0, busyMs: 0 } }, 14, now)
  expect(series.length).toBe(14)
  expect(series[13]!.day).toBe('2026-11-07')
  expect(series[0]!.day).toBe('2026-10-25')
  expect(series[12]!.t.actions).toBe(0)
  expect(sparkline(series).endsWith('█')).toBe(true)
})

test('records older than the keeping window are stale', async () => {
  const now = Date.parse('2026-11-07T12:00:00')
  expect(isStale('2026-09-01', now)).toBe(true)
  expect(isStale(dayOf(now), now)).toBe(false)
})
