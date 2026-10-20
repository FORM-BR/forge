/** Create a git worktree beside a repository so parallel work never shares one checkout. */

import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceWorktreeRequest, WorkspaceWorktreeValue } from './types.ts'

/** Longest directory and branch segment derived from a task title. */
const SLUG_MAX = 40

/** Numbered suffixes tried before giving up on a taken path. */
const COLLISION_LIMIT = 20

/**
 * Reduce a task title to one path and branch segment: lowercase ASCII words
 * joined by single dashes. An unpronounceable title still names something.
 * @param title - the offered task title.
 * @returns a non-empty slug of at most {@link SLUG_MAX} characters.
 */
export function worktreeSlug(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug === '' ? 'work' : slug
}

/**
 * Create a git worktree of the repository containing `cwd`, from its current
 * HEAD, in a sibling `<repo>-worktrees/<slug>` directory on a new `forge/<slug>`
 * branch. A taken directory or branch moves to the next numbered suffix.
 *
 * The work is a real git operation, so a refusal (dirty index, existing branch,
 * unwritable parent, missing git) answers as a Remote error with git's own
 * message; only the caller's abort rejects unchanged.
 * @param request - directory inside the repository and the task title naming the worktree.
 * @param signal - caller lifetime; abort terminates the running git child.
 * @param timeoutMs - deadline for each git invocation.
 * @param run - command runner, replaceable in tests.
 * @returns the created worktree path and the branch checked out there.
 * @throws {RemoteError} `workspace/not-a-repository` or `workspace/worktree-failed`.
 */
export async function createWorktree(
  request: WorkspaceWorktreeRequest,
  signal: AbortSignal,
  timeoutMs: number,
  run: NativeCommandRunner = runNativeCommand,
): Promise<WorkspaceWorktreeValue> {
  const git = async (cwd: string, args: readonly string[]): Promise<string> => {
    const { stdout } = await run('git', ['-C', cwd, ...args], AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), 'hidden')
    return stdout.trim()
  }
  let root: string
  try {
    root = await git(request.cwd, ['rev-parse', '--show-toplevel'])
  } catch (error) {
    signal.throwIfAborted()
    throw new RemoteError(
      'workspace/not-a-repository',
      `"${request.cwd}" is not inside a git repository`,
      { path: request.cwd },
      { cause: error },
    )
  }
  if (root === '') {
    throw new RemoteError(
      'workspace/not-a-repository',
      `"${request.cwd}" is not inside a git repository`,
      { path: request.cwd },
    )
  }
  const slug = worktreeSlug(request.title)
  const parent = join(dirname(root), `${basename(root)}-worktrees`)
  let path = join(parent, slug)
  let branch = `forge/${slug}`
  for (let suffix = 2; existsSync(path) && suffix <= COLLISION_LIMIT; suffix += 1) {
    path = join(parent, `${slug}-${suffix}`)
    branch = `forge/${slug}-${suffix}`
  }
  try {
    await git(root, ['worktree', 'add', '-b', branch, path])
  } catch (error) {
    signal.throwIfAborted()
    throw new RemoteError(
      'workspace/worktree-failed',
      `cannot create a worktree at "${path}": ${error instanceof Error ? error.message : String(error)}`,
      { path },
      { cause: error },
    )
  }
  return { path, branch }
}
