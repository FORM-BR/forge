import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { createWorktree, worktreeSlug } from '../src/worktree.ts'

const signal = (): AbortSignal => new AbortController().signal

/** Runner answering the repository lookup and recording the worktree command. */
function runnerFor(root: string, onAdd?: (args: readonly string[]) => void): ReturnType<typeof vi.fn<NativeCommandRunner>> {
  return vi.fn<NativeCommandRunner>(async (_command, args) => {
    const subcommand = args.slice(2).join(' ')
    if (subcommand === 'rev-parse --show-toplevel') return { stdout: `${root}\n`, stderr: '' }
    onAdd?.(args)
    if (subcommand.startsWith('worktree add')) return { stdout: '', stderr: '' }
    throw Object.assign(new Error(`git ${subcommand} failed`), { code: 128 })
  })
}

const temporary: string[] = []

/** A fresh directory that the spec owns and removes. */
function temporaryPath(name: string): string {
  const base = mkdtempSync(join(tmpdir(), 'dsh-worktree-'))
  temporary.push(base)
  return join(base, name)
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('worktreeSlug', () => {
  it('reduces a title to lowercase ASCII words joined by single dashes', () => {
    expect(worktreeSlug('Waitlist copy — v2!')).toBe('waitlist-copy-v2')
    expect(worktreeSlug('  Ação: relatório  ')).toBe('acao-relatorio')
  })

  it('shortens a long title without a trailing dash', () => {
    const slug = worktreeSlug(`${'word '.repeat(20)}end`)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('still names the work when the title carries no usable word', () => {
    expect(worktreeSlug('***')).toBe('work')
  })
})

describe('createWorktree', () => {
  it('creates a sibling worktree on a new branch from the repository root', async () => {
    const root = temporaryPath('my-repo')
    mkdirSync(root, { recursive: true })
    let created: readonly string[] | undefined
    const run = runnerFor(root, (args) => { created = args })

    const result = await createWorktree({ cwd: join(root, 'src'), title: 'Waitlist copy' }, signal(), 1_000, run)

    const expected = join(dirname(root), 'my-repo-worktrees', 'waitlist-copy')
    expect(result).toEqual({ path: expected, branch: 'forge/waitlist-copy' })
    expect(created).toEqual(['-C', root, 'worktree', 'add', '-b', 'forge/waitlist-copy', expected])
  })

  it('numbers the path and branch when the slug is already taken', async () => {
    const root = temporaryPath('my-repo')
    mkdirSync(join(dirname(root), 'my-repo-worktrees', 'waitlist-copy'), { recursive: true })
    let created: readonly string[] | undefined
    const run = runnerFor(root, (args) => { created = args })

    const result = await createWorktree({ cwd: root, title: 'Waitlist copy' }, signal(), 1_000, run)

    expect(result).toEqual({
      path: join(dirname(root), 'my-repo-worktrees', 'waitlist-copy-2'),
      branch: 'forge/waitlist-copy-2',
    })
    expect(created).toEqual(['-C', root, 'worktree', 'add', '-b', 'forge/waitlist-copy-2', result.path])
  })

  it('answers a directory outside a repository as a Remote error', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => {
      throw Object.assign(new Error('not a git repository'), { code: 128 })
    })
    await expect(createWorktree({ cwd: '/tmp/plain', title: 'work' }, signal(), 1_000, run))
      .rejects.toMatchObject({ code: 'workspace/not-a-repository', details: { path: '/tmp/plain' } })
  })

  it('answers a git refusal with the worktree path git reported on', async () => {
    const root = temporaryPath('my-repo')
    mkdirSync(root, { recursive: true })
    const run = vi.fn<NativeCommandRunner>(async (_command, args) => {
      const subcommand = args.slice(2).join(' ')
      if (subcommand === 'rev-parse --show-toplevel') return { stdout: `${root}\n`, stderr: '' }
      throw Object.assign(new Error("fatal: 'forge/work' is already checked out"), { code: 128 })
    })

    const failure = await createWorktree({ cwd: root, title: 'work' }, signal(), 1_000, run)
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'workspace/worktree-failed',
      details: { path: join(dirname(root), 'my-repo-worktrees', 'work') },
    })
    expect(String(failure)).toContain('already checked out')
  })

  it('rejects with the caller abort instead of a business refusal', async () => {
    const caller = new AbortController()
    const hang: NativeCommandRunner = (_command, _args, abort) => new Promise((_resolve, reject) => {
      abort.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const pending = createWorktree({ cwd: '/tmp/slow', title: 'work' }, caller.signal, 60_000, hang)
    caller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
