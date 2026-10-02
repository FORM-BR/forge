import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { isGitInfoPath, resolveGitInfo } from '../src/git-info.ts'

const signal = (): AbortSignal => new AbortController().signal

/** Runner answering by git subcommand; a missing entry fails like a non-zero git exit. */
function runnerFor(answers: Record<string, string>): ReturnType<typeof vi.fn<NativeCommandRunner>> {
  return vi.fn<NativeCommandRunner>(async (_command, args) => {
    const subcommand = args.slice(2).join(' ')
    const stdout = answers[subcommand]
    if (stdout === undefined) throw Object.assign(new Error(`git ${subcommand} failed`), { code: 128 })
    return { stdout, stderr: '' }
  })
}

describe('resolveGitInfo', () => {
  it('reports the repository name, root, and branch', async () => {
    const run = runnerFor({
      'rev-parse --show-toplevel': 'C:/work/my-repo\n',
      'symbolic-ref --short -q HEAD': 'feat/status-bar\n',
    })
    const abort = signal()
    await expect(resolveGitInfo('C:\\work\\my-repo\\src', abort, 1_000, run)).resolves.toEqual({
      path: 'C:\\work\\my-repo\\src',
      git: { repoName: 'my-repo', root: 'C:/work/my-repo', branch: 'feat/status-bar', detached: false },
    })
    expect(run).toHaveBeenCalledWith(
      'git', ['-C', 'C:\\work\\my-repo\\src', 'rev-parse', '--show-toplevel'], expect.any(AbortSignal), 'hidden',
    )
  })

  it('labels a detached HEAD with the abbreviated commit', async () => {
    const run = runnerFor({
      'rev-parse --show-toplevel': '/home/a/repo\n',
      'rev-parse --short HEAD': 'a1b2c3d\n',
    })
    await expect(resolveGitInfo('/home/a/repo', signal(), 1_000, run)).resolves.toEqual({
      path: '/home/a/repo',
      git: { repoName: 'repo', root: '/home/a/repo', branch: 'a1b2c3d', detached: true },
    })
  })

  it('answers without git outside a repository, without a git executable, and on an empty toplevel', async () => {
    await expect(resolveGitInfo('/tmp/plain', signal(), 1_000, runnerFor({}))).resolves.toEqual({ path: '/tmp/plain' })
    const missing = vi.fn<NativeCommandRunner>(async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    })
    await expect(resolveGitInfo('/tmp/plain', signal(), 1_000, missing)).resolves.toEqual({ path: '/tmp/plain' })
    await expect(resolveGitInfo('/tmp/plain', signal(), 1_000, runnerFor({ 'rev-parse --show-toplevel': '\n' })))
      .resolves.toEqual({ path: '/tmp/plain' })
  })

  it('answers without git when the deadline expires but rejects when the caller aborts', async () => {
    const hang: NativeCommandRunner = (_command, _args, abort) => new Promise((_resolve, reject) => {
      abort.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    await expect(resolveGitInfo('/tmp/slow', signal(), 5, hang)).resolves.toEqual({ path: '/tmp/slow' })
    const caller = new AbortController()
    const pending = resolveGitInfo('/tmp/slow', caller.signal, 60_000, hang)
    caller.abort()
    await expect(pending).rejects.toBeDefined()
  })
})

describe('isGitInfoPath', () => {
  it('accepts a fully qualified path and refuses empty and relative paths', () => {
    expect(isGitInfoPath(process.cwd())).toBe(true)
    expect(isGitInfoPath('relative/dir')).toBe(false)
    expect(isGitInfoPath('')).toBe(false)
  })
})
