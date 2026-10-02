/** Read-only git repository facts for one Host directory. */

import { basename, isAbsolute } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { WorkspaceGitInfoValue, WorkspaceGitRepo } from './types.ts'

/**
 * Resolve the git repository containing a directory.
 *
 * Absence of git is an answer, not a failure: a missing `git` executable, a
 * directory outside any repository, an unreadable or missing directory, an
 * unsafe-ownership refusal, and an expired deadline all return a value without
 * `git`. Only the caller's own abort rejects.
 * @param path - fully qualified directory on the Host.
 * @param signal - caller lifetime; abort terminates the running git child.
 * @param timeoutMs - deadline for the whole lookup.
 * @param run - command runner, replaceable in tests.
 * @returns the directory with its repository name, root, and current branch when inside a repository.
 */
export async function resolveGitInfo(
  path: string,
  signal: AbortSignal,
  timeoutMs: number,
  run: NativeCommandRunner = runNativeCommand,
): Promise<WorkspaceGitInfoValue> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const git = (args: readonly string[]): Promise<string> =>
    run('git', ['-C', path, ...args], bounded, 'hidden').then(({ stdout }) => stdout.trim())
  try {
    const root = await git(['rev-parse', '--show-toplevel'])
    if (root === '') return { path }
    // `symbolic-ref` also answers on an unborn branch (no commits yet), where
    // `rev-parse --abbrev-ref HEAD` fails; it exits non-zero only when detached.
    const branch = await git(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => undefined)
    if (branch !== undefined && branch !== '') return { path, git: repo(root, branch, false) }
    const commit = await git(['rev-parse', '--short', 'HEAD'])
    return { path, git: repo(root, commit, true) }
  } catch {
    // The deadline and every git failure resolve to "no repository"; only the caller's abort propagates.
    signal.throwIfAborted()
    return { path }
  }
}

/**
 * Whether a Remote caller's path may be handed to git.
 * @param path - caller-supplied directory.
 * @returns true for a non-empty absolute path.
 */
export function isGitInfoPath(path: string): boolean {
  return path !== '' && isAbsolute(path)
}

function repo(root: string, branch: string, detached: boolean): WorkspaceGitRepo {
  return { repoName: basename(root), root, branch, detached }
}
