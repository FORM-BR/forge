/** Read-only git history for one Host directory, shaped for the Git Map. */

import { basename, isAbsolute } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type {
  WorkspaceGitGraph,
  WorkspaceGitGraphBranch,
  WorkspaceGitGraphCommit,
  WorkspaceGitGraphCommitType,
  WorkspaceGitGraphStation,
  WorkspaceGitGraphValue,
} from './types.ts'

/** Stations read when the caller names no limit. */
export const GIT_GRAPH_DEFAULT_LIMIT = 18
/** Largest number of stations one lookup reads. */
export const GIT_GRAPH_MAX_LIMIT = 100

/** Unmerged branches listed on the map; the rest are only counted. */
const MAX_OPEN_BRANCHES = 6
/** Unmerged branch tips considered before stacked ones are folded together. */
const MAX_BRANCH_TIPS = 40
/** Commits kept per merged branch (the newest ones). */
const STATION_COMMITS = 3
/** Commits kept per unmerged branch (the newest ones). */
const BRANCH_COMMITS = 12
/** Longest station name sent to the client. */
const NAME_LIMIT = 80
/** Git children running at once. */
const CONCURRENCY = 8

/** Record and unit separators keep a subject line from ever being mistaken for structure. */
const LOG_FORMAT = '%H%x1f%P%x1f%ad%x1f%an%x1f%s%x1e'

interface RawCommit {
  readonly hash: string
  readonly parents: readonly string[]
  readonly date: string
  readonly author: string
  readonly message: string
}

/**
 * Whether a Remote caller's path may be handed to git.
 * @param path - caller-supplied directory.
 * @returns true for a non-empty absolute path.
 */
export function isGitGraphPath(path: string): boolean {
  return path !== '' && isAbsolute(path)
}

/**
 * Bring a caller-supplied station count into range.
 * @param limit - requested count, or undefined for the default.
 * @returns an integer between 1 and {@link GIT_GRAPH_MAX_LIMIT}.
 */
export function clampGitGraphLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return GIT_GRAPH_DEFAULT_LIMIT
  return Math.min(GIT_GRAPH_MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

/**
 * Classify a commit by its conventional-commit prefix.
 * @param message - subject line.
 * @returns `feat`, `fix`, or `other`.
 */
export function commitType(message: string): WorkspaceGitGraphCommitType {
  const type = /^(\w+)(?:\([^)]*\))?!?:/.exec(message)?.[1]
  return type === 'feat' ? 'feat' : type === 'fix' ? 'fix' : 'other'
}

/**
 * Read the history of the repository containing a directory.
 *
 * Absence is an answer, not a failure: a directory outside any repository (or a
 * missing `git`) and a repository without commits each resolve to a value
 * naming the state, and a git error or an expired deadline resolves to
 * `failed`. Only the caller's own abort rejects. Every git call is read-only
 * (`rev-parse`, `log`, `rev-list`, `for-each-ref`, `merge-base`, `symbolic-ref`).
 * @param path - fully qualified directory on the Host.
 * @param limit - main-line stations to read; clamped to 1..100.
 * @param signal - caller lifetime; abort terminates the running git children.
 * @param timeoutMs - deadline for the whole lookup.
 * @param run - command runner, replaceable in tests.
 * @returns the echoed path plus the lookup state and, when ready, the graph.
 */
export async function resolveGitGraph(
  path: string,
  limit: number | undefined,
  signal: AbortSignal,
  timeoutMs: number,
  run: NativeCommandRunner = runNativeCommand,
): Promise<WorkspaceGitGraphValue> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const bounded = AbortSignal.any([signal, deadline])
  const git = (args: readonly string[]): Promise<string> =>
    run('git', ['-C', path, '-c', 'core.quotepath=false', ...args], bounded, 'hidden')
      .then(({ stdout }) => stdout.trim())
  /** A git call whose failure is an answer; only an abort propagates. */
  const attempt = async (args: readonly string[]): Promise<string | undefined> => {
    try {
      return await git(args)
    } catch {
      bounded.throwIfAborted()
      return undefined
    }
  }
  try {
    const root = await attempt(['rev-parse', '--show-toplevel'])
    if (root === undefined || root === '') return { path, state: 'no-repository' }
    const head = await attempt(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    if (head === undefined || head === '') return { path, state: 'no-commits' }
    const graph = await readGraph(git, attempt, root, head, clampGitGraphLimit(limit))
    return { path, state: 'ready', graph }
  } catch {
    // The deadline and every git failure resolve to "failed"; only the caller's abort propagates.
    signal.throwIfAborted()
    return { path, state: 'failed' }
  }
}

type Git = (args: readonly string[]) => Promise<string>
type Attempt = (args: readonly string[]) => Promise<string | undefined>

async function readGraph(
  git: Git,
  attempt: Attempt,
  root: string,
  head: string,
  limit: number,
): Promise<WorkspaceGitGraph> {
  const log = async (revisions: readonly string[], extra: readonly string[]): Promise<RawCommit[]> =>
    parseLog(await git(['log', ...extra, '--date=short', `--pretty=format:${LOG_FORMAT}`, ...revisions]))
  const count = async (range: string): Promise<number> =>
    toCount(await git(['rev-list', '--count', '--no-merges', range]))
  const { base, baseSha } = await resolveBase(attempt, head)
  const headBranch = await attempt(['symbolic-ref', '--short', '-q', 'HEAD']) ?? 'HEAD'

  const [total, merges, chain] = await Promise.all([
    git(['rev-list', '--count', '--all']).then(toCount),
    git(['rev-list', '--merges', '--count', '--all']).then(toCount),
    log([baseSha], ['--first-parent', '-n', String(limit)]),
  ])

  const stations = await mapLimit(chain.reverse(), async (commit): Promise<WorkspaceGitGraphStation> => {
    const [first, second] = commit.parents
    if (first === undefined || second === undefined) return station(commit, [], 0)
    const range = `${first}..${second}`
    const [picked, branchCount] = await Promise.all([
      log([range], ['--no-merges', '-n', String(STATION_COMMITS)]),
      count(range),
    ])
    return station(commit, picked.reverse(), branchCount)
  })

  const open = await readOpenBranches(git, attempt, log, count, baseSha, head)
  return {
    repoName: basename(root),
    root,
    base,
    head,
    headBranch,
    total,
    merges,
    stations,
    branches: open.slice(0, MAX_OPEN_BRANCHES),
    moreBranches: Math.max(0, open.length - MAX_OPEN_BRANCHES),
  }
}

/** The main line: a local `main` or `master`, else the remote default branch, else HEAD itself. */
async function resolveBase(attempt: Attempt, head: string): Promise<{ base: string; baseSha: string }> {
  for (const name of ['main', 'master']) {
    const sha = await attempt(['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`])
    if (sha !== undefined && sha !== '') return { base: name, baseSha: sha }
  }
  const remoteHead = await attempt(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'])
  if (remoteHead !== undefined && remoteHead.startsWith('refs/remotes/')) {
    const sha = await attempt(['rev-parse', '--verify', '--quiet', `${remoteHead}^{commit}`])
    if (sha !== undefined && sha !== '') return { base: remoteHead.slice('refs/remotes/'.length), baseSha: sha }
  }
  return { base: 'HEAD', baseSha: head }
}

async function readOpenBranches(
  git: Git,
  attempt: Attempt,
  log: (revisions: readonly string[], extra: readonly string[]) => Promise<RawCommit[]>,
  count: (range: string) => Promise<number>,
  baseSha: string,
  head: string,
): Promise<WorkspaceGitGraphBranch[]> {
  // `--no-merged` keeps only refs whose tip is not reachable from the base, newest first.
  const listing = await git([
    'for-each-ref', `--no-merged=${baseSha}`, '--sort=-committerdate',
    '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes',
  ])
  const byTip = new Map<string, { sha: string; local: string[]; remote: string[] }>()
  for (const line of listing.split('\n')) {
    const [ref, sha] = line.trim().split(' ')
    if (ref === undefined || sha === undefined || sha === '') continue
    const isLocal = ref.startsWith('refs/heads/')
    const name = isLocal ? ref.slice('refs/heads/'.length) : ref.slice('refs/remotes/'.length)
    if (!isLocal && (!ref.startsWith('refs/remotes/') || /\/HEAD$/.test(name))) continue
    if (name === 'main' || name === 'master' || name.endsWith('/main') || name.endsWith('/master')) continue
    const entry = byTip.get(sha) ?? { sha, local: [], remote: [] }
    ;(isLocal ? entry.local : entry.remote).push(name)
    byTip.set(sha, entry)
  }
  const tips = [...byTip.values()].slice(0, MAX_BRANCH_TIPS)
  if (tips.length === 0) return []
  // Branches stacked on one another collapse to the topmost tip.
  const independent = tips.length === 1
    ? new Set(tips.map(tip => tip.sha))
    : new Set((await git(['merge-base', '--independent', ...tips.map(tip => tip.sha)])).split('\n').map(line => line.trim()))
  const kept = tips.filter(tip => independent.has(tip.sha))
  const headOnBase = head === baseSha || await isAncestor(attempt, head, baseSha)
  const branches = await mapLimit(kept, async (tip): Promise<WorkspaceGitGraphBranch | undefined> => {
    const range = `${baseSha}..${tip.sha}`
    const [picked, commitCount] = await Promise.all([
      log([range], ['--no-merges', '-n', String(BRANCH_COMMITS)]),
      count(range),
    ])
    if (commitCount === 0) return undefined
    const names = [...tip.local, ...tip.remote]
    return {
      name: names[0] ?? tip.sha.slice(0, 7),
      aliases: names.length - 1,
      commits: picked.reverse().map(slim),
      commitCount,
      isHead: !headOnBase && await isAncestor(attempt, head, tip.sha),
    }
  })
  return branches.filter((branch): branch is WorkspaceGitGraphBranch => branch !== undefined)
}

async function isAncestor(attempt: Attempt, ancestor: string, descendant: string): Promise<boolean> {
  return await attempt(['merge-base', '--is-ancestor', ancestor, descendant]) !== undefined
}

function parseLog(output: string): RawCommit[] {
  return output.split('\x1e').map(record => record.trim()).filter(record => record !== '').map((record) => {
    const [hash = '', parents = '', date = '', author = '', ...subject] = record.split('\x1f')
    return {
      hash, parents: parents === '' ? [] : parents.split(' '), date, author, message: subject.join('\x1f'),
    }
  })
}

function toCount(output: string): number {
  const value = Number.parseInt(output, 10)
  return Number.isFinite(value) ? value : 0
}

function slim(commit: RawCommit): WorkspaceGitGraphCommit {
  return {
    hash: commit.hash,
    short: commit.hash.slice(0, 7),
    type: commitType(commit.message),
    message: commit.message,
    date: commit.date,
    author: commit.author,
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function station(
  commit: RawCommit,
  picked: readonly RawCommit[],
  commitCount: number,
): WorkspaceGitGraphStation {
  const merge = commit.parents.length > 1
  const pullRequest = /#(\d+)/.exec(commit.message)?.[1]
  const fromBranch = /from [^/\s]+\/(\S+)/.exec(commit.message)?.[1]
    ?? /Merge branch '([^']+)'/.exec(commit.message)?.[1]
  const name = merge && fromBranch !== undefined
    ? fromBranch.replace(/^(feat|fix|chore|docs|refactor|hotfix|claude)\//, '')
    : commit.message.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/\s*\(#\d+\)\s*$/, '')
  return {
    hash: commit.hash,
    short: commit.hash.slice(0, 7),
    kind: merge ? 'merge' : 'commit',
    type: merge ? 'merge' : commitType(commit.message),
    date: commit.date,
    message: commit.message,
    author: commit.author,
    label: pullRequest === undefined ? commit.hash.slice(0, 7) : `#${pullRequest}`,
    name: truncate(name, NAME_LIMIT),
    commits: picked.map(slim),
    commitCount,
  }
}

/** Map with at most {@link CONCURRENCY} calls in flight, preserving order. */
async function mapLimit<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      const item = items[index]
      if (index >= items.length || item === undefined) return
      results[index] = await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}
