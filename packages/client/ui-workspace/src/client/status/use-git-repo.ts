/** Git repository lookup shared by the workspace status entries. */
import { useEffect, useState } from 'react'
import type { WorkspaceGitInfoValue, WorkspaceGitRepo } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** The repository found for one directory, or none; keyed so a stale answer never shows under another path. */
interface GitLookup {
  readonly path: string
  readonly repo: WorkspaceGitRepo | undefined
}

/**
 * Look up the git repository containing a directory, again whenever the
 * directory or `refresh` changes. A refused or lost lookup yields no
 * repository; the previous answer stays visible while a repeat runs, and an
 * answer recorded for another directory is never returned.
 * @param path - Host directory, or undefined for none (no lookup runs).
 * @param refresh - value whose change repeats the lookup for the same directory.
 * @param gitInfo - the injected Host lookup.
 * @returns the repository facts for `path`, or undefined.
 */
export function useGitRepo(
  path: string | undefined,
  refresh: unknown,
  gitInfo: (path: string, signal: AbortSignal) => Promise<WorkspaceGitInfoValue>,
): WorkspaceGitRepo | undefined {
  const [lookup, setLookup] = useState<GitLookup | undefined>(undefined)
  useEffect(() => {
    if (path === undefined) return
    const abort = new AbortController()
    gitInfo(path, abort.signal).then(
      (value) => { if (!abort.signal.aborted) setLookup({ path, repo: value.git }) },
      // A refused or lost lookup shows no repository.
      () => { if (!abort.signal.aborted) setLookup({ path, repo: undefined }) },
    )
    return () => { abort.abort() }
  }, [path, refresh, gitInfo])
  return lookup !== undefined && lookup.path === path ? lookup.repo : undefined
}
