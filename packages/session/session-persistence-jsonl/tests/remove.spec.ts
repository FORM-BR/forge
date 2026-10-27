import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { sessionDir } from '../src/format.ts'

let root: string
let ctx: Context
let persistence: SessionPersistence

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-remove-'))
  ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  persistence = ctx.sessionPersistence
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** Persist one finished session and release its write ownership. */
async function store(id: string, cwd: string): Promise<void> {
  const handle = await persistence.create(meta(id, cwd))
  await handle.append(oneTurnLog())
  await handle.close()
}

describe('JsonlSessionPersistence.remove', () => {
  it('deletes the whole session directory and makes the session unknown', async () => {
    await store('gone', '/work/a')
    const dir = sessionDir(root, '/work/a', SessionId('gone'))
    expect((await readdir(dir)).length).toBeGreaterThan(0)

    await expect(persistence.remove(SessionId('gone'))).resolves.toBe(true)

    await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await persistence.stat(SessionId('gone'))).toBeUndefined()
    expect((await persistence.list()).map(snapshot => snapshot.header.id)).toEqual([])
    await expect(persistence.open(SessionId('gone'), 'read')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
  })

  it('leaves every other session untouched', async () => {
    await store('gone', '/work/a')
    await store('kept', '/work/a')
    await persistence.remove(SessionId('gone'))
    expect((await persistence.list()).map(snapshot => snapshot.header.id)).toEqual([SessionId('kept')])
    const handle = await persistence.open(SessionId('kept'), 'read')
    expect((await handle.read()).events).toHaveLength(oneTurnLog().length)
    await handle.close()
  })

  it('resolves false for an unknown session', async () => {
    await expect(persistence.remove(SessionId('never'))).resolves.toBe(false)
  })

  it('refuses a session that a write handle still owns, and removes it after release', async () => {
    const handle = await persistence.create(meta('busy', '/work/a'))
    await handle.append(oneTurnLog())
    await handle.flush()
    await expect(persistence.remove(SessionId('busy'))).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    expect(await persistence.stat(SessionId('busy'))).toBeDefined()

    await handle.close()
    await expect(persistence.remove(SessionId('busy'))).resolves.toBe(true)
  })

  it('refuses a created session that has not reached storage yet', async () => {
    const handle = await persistence.create(meta('fresh', '/work/a'))
    await expect(persistence.remove(SessionId('fresh'))).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await handle.close()
  })

  it('honors an already aborted signal before touching anything', async () => {
    await store('kept', '/work/a')
    await expect(persistence.remove(SessionId('kept'), { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(await persistence.stat(SessionId('kept'))).toBeDefined()
  })

  it('allows the id to be created again after removal', async () => {
    await store('again', '/work/a')
    await persistence.remove(SessionId('again'))
    await store('again', '/work/a')
    expect(await persistence.stat(SessionId('again'))).toBeDefined()
  })
})
