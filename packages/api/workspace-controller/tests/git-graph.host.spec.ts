import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import {
  GIT_GRAPH_DEFAULT_LIMIT, GIT_GRAPH_MAX_LIMIT, clampGitGraphLimit, commitType, isGitGraphPath, resolveGitGraph,
} from '../src/git-graph.ts'

const signal = (): AbortSignal => new AbortController().signal

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    // No git executable on this machine: the real-repository cases are skipped.
    return false
  }
})()

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch repository driven through the real git executable, with one commit per simulated day. */
class Repo {
  readonly dir: string
  private day = 0

  constructor(initialBranch: string | undefined = 'main', init = true) {
    this.dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-git-graph-')))
    tempDirs.push(this.dir)
    if (init) this.git(...initialBranch === undefined ? ['init'] : ['init', '-b', initialBranch])
  }

  git(...args: string[]): string {
    return execFileSync('git', [
      '-C', this.dir, '-c', 'user.name=Test Author', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }

  /** Commit an empty change dated one day after the previous commit. */
  commit(message: string): string {
    const date = new Date(Date.UTC(2026, 0, 10 + this.day++, 12)).toISOString()
    execFileSync('git', [
      '-C', this.dir, '-c', 'user.name=Test Author', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', message,
    ], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: 'ignore' })
    return this.git('rev-parse', 'HEAD')
  }

  /** Merge with a real merge commit, dated like {@link commit}. */
  merge(branch: string, message: string): string {
    const date = new Date(Date.UTC(2026, 0, 10 + this.day++, 12)).toISOString()
    execFileSync('git', [
      '-C', this.dir, '-c', 'user.name=Test Author', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'merge', '--no-ff', '-m', message, branch,
    ], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: 'ignore' })
    return this.git('rev-parse', 'HEAD')
  }
}

/** The history every real-repository case reads: a merged PR, a direct commit, an open branch, and one stacked on it. */
function scenario(): Repo {
  const repo = new Repo()
  repo.commit('chore: init')
  repo.git('switch', '-c', 'feat/alpha')
  repo.commit('feat: alpha one')
  repo.commit('fix(core): alpha two')
  repo.git('switch', 'main')
  repo.merge('feat/alpha', 'Merge pull request #7 from user/feat/alpha')
  repo.commit('docs: direct commit on main')
  repo.git('branch', 'merged-old', 'main~1')
  repo.git('switch', '-c', 'feat/open')
  repo.commit('feat: open one')
  repo.commit('feat: open two')
  repo.git('switch', '-c', 'feat/stacked')
  const tip = repo.commit('fix: stacked one')
  // A remote-tracking alias of the tip, the remote's own main line, and its symbolic HEAD.
  repo.git('update-ref', 'refs/remotes/origin/feat/stacked', tip)
  repo.git('update-ref', 'refs/remotes/origin/main', repo.git('rev-parse', 'main'))
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  return repo
}

// Each case spawns a few dozen git processes; process creation is slow on Windows, more so with the suites running in parallel.
describe('resolveGitGraph against a real repository', { timeout: 60_000 }, () => {
  it.skipIf(!gitAvailable)('maps merges, direct commits, open branches, stacked branches, and the head', async () => {
    const repo = scenario()
    const value = await resolveGitGraph(repo.dir, undefined, signal(), 20_000)
    expect(value.state).toBe('ready')
    const graph = value.graph!
    expect(value.path).toBe(repo.dir)
    expect(graph).toMatchObject({
      repoName: repo.dir.split(/[\\/]/).pop(), base: 'main', headBranch: 'feat/stacked', total: 8, merges: 1,
      moreBranches: 0,
    })
    expect(graph.head).toBe(repo.git('rev-parse', 'HEAD'))

    expect(graph.stations.map(s => [s.kind, s.type, s.label === s.short ? 'hash' : s.label, s.name, s.commitCount]))
      .toEqual([
        ['commit', 'other', 'hash', 'init', 0],
        ['merge', 'merge', '#7', 'alpha', 2],
        ['commit', 'other', 'hash', 'direct commit on main', 0],
      ])
    const merge = graph.stations[1]!
    expect(merge.commits.map(c => [c.type, c.message, c.date, c.author, c.short === c.hash.slice(0, 7)])).toEqual([
      ['feat', 'feat: alpha one', '2026-01-11', 'Test Author', true],
      ['fix', 'fix(core): alpha two', '2026-01-12', 'Test Author', true],
    ])
    expect(merge.date).toBe('2026-01-13')
    expect(merge.author).toBe('Test Author')
    expect(graph.stations[0]!.date).toBe('2026-01-10')

    // `feat/open` is folded into `feat/stacked`; `merged-old` and the remote main line are not unmerged branches.
    expect(graph.branches).toHaveLength(1)
    const branch = graph.branches[0]!
    expect(branch).toMatchObject({ name: 'feat/stacked', aliases: 1, commitCount: 3, isHead: true })
    expect(branch.commits.map(c => [c.type, c.message])).toEqual([
      ['feat', 'feat: open one'], ['feat', 'feat: open two'], ['fix', 'fix: stacked one'],
    ])
  })

  it.skipIf(!gitAvailable)('reads only the newest stations when the limit is small', async () => {
    const repo = scenario()
    const value = await resolveGitGraph(repo.dir, 2, signal(), 20_000)
    expect(value.graph!.stations.map(s => s.name)).toEqual(['alpha', 'direct commit on main'])
  })

  it.skipIf(!gitAvailable)('finds no repository inside the git directory and does not flag the head while it sits on the base', async () => {
    const repo = scenario()
    repo.git('switch', 'main')
    const value = await resolveGitGraph(join(repo.dir, '.git'), undefined, signal(), 20_000)
    // Inside the git directory there is no work tree, so there is no top level to resolve.
    expect(value.state).toBe('no-repository')
    const onMain = await resolveGitGraph(repo.dir, undefined, signal(), 20_000)
    expect(onMain.graph).toMatchObject({ headBranch: 'main' })
    expect(onMain.graph!.branches.map(b => [b.name, b.isHead])).toEqual([['feat/stacked', false]])
  })

  it.skipIf(!gitAvailable)('lists at most six branches and counts the rest', async () => {
    const repo = new Repo()
    repo.commit('chore: init')
    for (let index = 0; index < 8; index++) {
      repo.git('switch', '-c', `topic/${index}`, 'main')
      repo.commit(`feat: topic ${index}`)
    }
    repo.git('switch', 'main')
    const graph = (await resolveGitGraph(repo.dir, undefined, signal(), 20_000)).graph!
    expect(graph.branches).toHaveLength(6)
    expect(graph.moreBranches).toBe(2)
    // Newest first.
    expect(graph.branches.map(b => b.name)).toEqual(['topic/7', 'topic/6', 'topic/5', 'topic/4', 'topic/3', 'topic/2'])
  })

  it.skipIf(!gitAvailable)('uses the checked-out line as the base when there is no main or master', async () => {
    const repo = new Repo('trunk')
    repo.commit('feat: one')
    repo.commit('two')
    const graph = (await resolveGitGraph(repo.dir, undefined, signal(), 20_000)).graph!
    expect(graph).toMatchObject({ base: 'HEAD', headBranch: 'trunk', total: 2, merges: 0, moreBranches: 0 })
    expect(graph.stations.map(s => [s.type, s.name])).toEqual([['feat', 'one'], ['other', 'two']])
    expect(graph.branches).toEqual([])
  })

  it.skipIf(!gitAvailable)('uses the remote default branch when there is no local main or master', async () => {
    const repo = new Repo('work')
    const first = repo.commit('chore: first')
    repo.git('update-ref', 'refs/remotes/origin/develop', first)
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop')
    repo.commit('feat: second')
    const graph = (await resolveGitGraph(repo.dir, undefined, signal(), 20_000)).graph!
    expect(graph.base).toBe('origin/develop')
    expect(graph.stations.map(s => s.name)).toEqual(['first'])
    expect(graph.branches.map(b => [b.name, b.commitCount, b.isHead])).toEqual([['work', 1, true]])
  })

  it.skipIf(!gitAvailable)('answers that a plain directory has no repository and an unborn one has no commits', async () => {
    const plain = new Repo(undefined, false)
    await expect(resolveGitGraph(plain.dir, undefined, signal(), 20_000))
      .resolves.toEqual({ path: plain.dir, state: 'no-repository' })
    const unborn = new Repo()
    await expect(resolveGitGraph(unborn.dir, undefined, signal(), 20_000))
      .resolves.toEqual({ path: unborn.dir, state: 'no-commits' })
  })
})

/** Runner answering by git subcommand; a missing entry fails like a non-zero git exit. */
function runnerFor(answers: Record<string, string>): ReturnType<typeof vi.fn<NativeCommandRunner>> {
  return vi.fn<NativeCommandRunner>(async (_command, args) => {
    const subcommand = args.slice(4).join(' ')
    const stdout = answers[subcommand]
    if (stdout === undefined) throw Object.assign(new Error(`git ${subcommand} failed`), { code: 128 })
    return { stdout, stderr: '' }
  })
}

describe('resolveGitGraph with a scripted git', () => {
  const NO_CHILDREN = {
    'rev-parse --show-toplevel': '/work/repo\n',
    'rev-parse --verify --quiet HEAD^{commit}': 'aaaaaaaaaaaaaaaaaaaa\n',
  }

  it('runs git without a shell, read-only, bounded to the path', async () => {
    const run = runnerFor(NO_CHILDREN)
    await resolveGitGraph('/work/repo/src', undefined, signal(), 1_000, run)
    expect(run).toHaveBeenNthCalledWith(
      1, 'git', ['-C', '/work/repo/src', '-c', 'core.quotepath=false', 'rev-parse', '--show-toplevel'],
      expect.any(AbortSignal), 'hidden',
    )
    const readOnly = ['rev-parse', 'symbolic-ref', 'rev-list', 'log', 'for-each-ref', 'merge-base']
    const subcommands = run.mock.calls.map(call => call[1][4])
    expect(subcommands.length).toBeGreaterThan(2)
    expect(subcommands.every(name => name !== undefined && readOnly.includes(name))).toBe(true)
  })

  it('reports a git failure after the repository was found as failed', async () => {
    // Every later call fails, so the base falls back to HEAD and the first count fails.
    await expect(resolveGitGraph('/work/repo', undefined, signal(), 1_000, runnerFor(NO_CHILDREN)))
      .resolves.toEqual({ path: '/work/repo', state: 'failed' })
  })

  it('reports an expired deadline as failed but rejects when the caller aborts', async () => {
    const hang: NativeCommandRunner = (_command, _args, abort) => new Promise((_resolve, reject) => {
      abort.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    await expect(resolveGitGraph('/tmp/slow', undefined, signal(), 5, hang))
      .resolves.toEqual({ path: '/tmp/slow', state: 'failed' })
    const caller = new AbortController()
    const pending = resolveGitGraph('/tmp/slow', undefined, caller.signal, 60_000, hang)
    caller.abort()
    await expect(pending).rejects.toBeDefined()
  })

  it('treats a missing git executable as no repository', async () => {
    const missing: NativeCommandRunner = async () => {
      throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    }
    await expect(resolveGitGraph('/tmp/plain', undefined, signal(), 1_000, missing))
      .resolves.toEqual({ path: '/tmp/plain', state: 'no-repository' })
  })
})

describe('git graph vocabulary', () => {
  it('accepts a fully qualified path and refuses empty and relative paths', () => {
    expect(isGitGraphPath(process.cwd())).toBe(true)
    expect(isGitGraphPath('relative/dir')).toBe(false)
    expect(isGitGraphPath('')).toBe(false)
  })

  it('clamps the station limit into 1..100 with a default of 18', () => {
    expect(clampGitGraphLimit(undefined)).toBe(GIT_GRAPH_DEFAULT_LIMIT)
    expect(clampGitGraphLimit(Number.NaN)).toBe(GIT_GRAPH_DEFAULT_LIMIT)
    expect(clampGitGraphLimit(0)).toBe(1)
    expect(clampGitGraphLimit(-5)).toBe(1)
    expect(clampGitGraphLimit(40.9)).toBe(40)
    expect(clampGitGraphLimit(10_000)).toBe(GIT_GRAPH_MAX_LIMIT)
  })

  it('classifies commits by their conventional-commit prefix', () => {
    expect(commitType('feat: add a thing')).toBe('feat')
    expect(commitType('feat(ui-workspace)!: break it')).toBe('feat')
    expect(commitType('fix(core): repair')).toBe('fix')
    expect(commitType('chore: tidy')).toBe('other')
    expect(commitType('Merge pull request #1 from a/b')).toBe('other')
    expect(commitType('feature: not conventional')).toBe('other')
  })
})
