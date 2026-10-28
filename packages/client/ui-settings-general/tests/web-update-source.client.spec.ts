// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WebUpdateSource, type WebUpdateStatus } from '../src/client/web-update-source.ts'

const KEY = 'dsh.update-notice.dismissed.v1'
const newer: WebUpdateStatus = { enabled: true, newerVersion: '1.2.0', releaseUrl: 'https://github.com/FORM-BR/forge/releases/tag/v1.2.0' }

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(reader: () => Promise<WebUpdateStatus | undefined>, initial = true) {
  const preference = createSnapshotStore(initial)
  const source = new WebUpdateSource(reader, preference)
  return { source, preference }
}

it('shows a newer release, ignores a repeated identical answer and keeps the snapshot stable', async () => {
  const read = vi.fn(async () => newer)
  const { source } = setup(read)
  await vi.advanceTimersByTimeAsync(0)
  const first = source.store.getSnapshot()
  expect(first.notice).toEqual({ version: '1.2.0', releaseUrl: newer.releaseUrl })
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(read).toHaveBeenCalledTimes(2)
  expect(source.store.getSnapshot()).toBe(first)
  source.dispose()
})

it('stays silent when the Host is off, current, failed, or reports an unsafe link', async () => {
  const answers: (WebUpdateStatus | undefined)[] = [
    { enabled: false },
    { enabled: true },
    // A private repository: GitHub answers 404, the Host reports the check as failed and the UI stays silent.
    { enabled: true, checking: false, failed: true },
    { enabled: true, newerVersion: '1.2.0' },
    { enabled: true, newerVersion: '1.2.0', releaseUrl: 'javascript:alert(1)' },
    undefined,
  ]
  const read = vi.fn(async () => answers.shift())
  const { source } = setup(read)
  for (let index = 0; index < 6; index++) {
    await vi.advanceTimersByTimeAsync(index === 5 ? 0 : 30 * 60_000)
    expect(source.store.getSnapshot()).toEqual({})
  }
  source.dispose()
})

it('keeps the last known answer when the Host cannot answer and retries after a minute', async () => {
  const answers: (WebUpdateStatus | undefined | Error)[] = [newer, undefined, new Error('offline'), newer]
  const read = vi.fn(async () => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next
  })
  const { source } = setup(read)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot().notice?.version).toBe('1.2.0')
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  expect(read).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledTimes(3)
  expect(source.store.getSnapshot().notice?.version).toBe('1.2.0')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledTimes(4)
  source.dispose()
})

it('polls quickly while the Host is still on its first check', async () => {
  const answers: WebUpdateStatus[] = [{ enabled: true, checking: true }, newer]
  const read = vi.fn(async () => answers.shift() ?? newer)
  const { source } = setup(read)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot()).toEqual({})
  await vi.advanceTimersByTimeAsync(3_000)
  expect(source.store.getSnapshot().notice?.version).toBe('1.2.0')
  source.dispose()
})

it('hides at once when the preference goes off, and settles against the Host reload when it returns', async () => {
  const answers: WebUpdateStatus[] = [newer, newer, { enabled: false }, { enabled: false }, newer]
  const read = vi.fn(async () => answers.shift() ?? newer)
  const { source, preference } = setup(read)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot().notice).toBeDefined()
  preference.set(false)
  expect(source.store.getSnapshot()).toEqual({})
  preference.set(false)
  await vi.advanceTimersByTimeAsync(0)
  // The Host has not reloaded yet (still enabled): keep polling fast until it agrees.
  await vi.advanceTimersByTimeAsync(3_000)
  expect(source.store.getSnapshot()).toEqual({})
  preference.set(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot()).toEqual({})
  await vi.advanceTimersByTimeAsync(3_000)
  expect(source.store.getSnapshot().notice?.version).toBe('1.2.0')
  source.dispose()
})

it('stops fast polling after a few attempts when the Host never agrees', async () => {
  const read = vi.fn(async (): Promise<WebUpdateStatus> => ({ enabled: false }))
  const { source, preference } = setup(read)
  await vi.advanceTimersByTimeAsync(0)
  const before = read.mock.calls.length
  preference.set(false)
  preference.set(true)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(3_000 * 10)
  // Five settle attempts at most, then back to the idle cadence.
  expect(read.mock.calls.length - before).toBeLessThanOrEqual(8)
  source.dispose()
})

it('dismisses per version, remembers it across sources, and shows a newer version again', async () => {
  const { source } = setup(async () => newer)
  await vi.advanceTimersByTimeAsync(0)
  source.dismiss()
  expect(source.store.getSnapshot()).toEqual({})
  expect(localStorage.getItem(KEY)).toBe('1.2.0')
  source.dismiss()
  source.dispose()

  const again = setup(async () => newer)
  await vi.advanceTimersByTimeAsync(0)
  expect(again.source.store.getSnapshot()).toEqual({})
  again.source.dispose()

  const later = setup(async () => ({ ...newer, newerVersion: '1.3.0' }))
  await vi.advanceTimersByTimeAsync(0)
  expect(later.source.store.getSnapshot().notice?.version).toBe('1.3.0')
  later.source.dispose()
})

it('works without browser storage', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
  })
  const { source } = setup(async () => newer)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot().notice?.version).toBe('1.2.0')
  source.dismiss()
  expect(source.store.getSnapshot()).toEqual({})
  source.dispose()
})

it('ignores answers that arrive after dispose', async () => {
  const pending = Promise.withResolvers<WebUpdateStatus>()
  const { source } = setup(() => pending.promise)
  source.dispose()
  pending.resolve(newer)
  await vi.advanceTimersByTimeAsync(0)
  expect(source.store.getSnapshot()).toEqual({})
})

it('ignores preference notifications that change nothing', async () => {
  let listener: (() => void) | undefined
  const read = vi.fn(async () => newer)
  const source = new WebUpdateSource(read, {
    getSnapshot: () => true,
    subscribe: (next) => { listener = next; return () => {} },
  })
  await vi.advanceTimersByTimeAsync(0)
  listener?.()
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledOnce()
  source.dispose()
})
