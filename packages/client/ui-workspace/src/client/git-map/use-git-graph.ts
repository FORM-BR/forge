/** Git history lookup for the Git Map tab. */
import { useEffect, useState } from 'react'
import type { WorkspaceGitGraphRequest, WorkspaceGitGraphValue } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** What the lookup for one directory settled on. */
export type GitGraphOutcome =
  | { readonly kind: 'value'; readonly value: WorkspaceGitGraphValue }
  | { readonly kind: 'error' }

/** The outcome recorded for one directory; keyed so an answer never shows under another directory. */
interface Recorded {
  readonly path: string
  readonly outcome: GitGraphOutcome
}

/** Result of {@link useGitGraph}. */
export interface GitGraphState {
  /** The latest outcome for the directory, or undefined until the first one arrives. */
  readonly outcome: GitGraphOutcome | undefined
  /** A lookup is in flight; the previous outcome for the same directory stays visible meanwhile. */
  readonly busy: boolean
}

/**
 * Read the git history of a directory, again whenever the directory, the
 * station limit, or `refresh` changes. A refused or lost lookup is an `error`
 * outcome; an outcome recorded for another directory is never returned.
 * @param path - Host directory, or undefined for none (no lookup runs).
 * @param limit - main-line stations to read.
 * @param refresh - value whose change repeats the lookup for the same directory.
 * @param gitGraph - the injected Host lookup.
 * @returns the latest outcome for `path` and whether a repeat is running.
 */
export function useGitGraph(
  path: string | undefined,
  limit: number,
  refresh: unknown,
  gitGraph: (request: WorkspaceGitGraphRequest, signal: AbortSignal) => Promise<WorkspaceGitGraphValue>,
): GitGraphState {
  const [recorded, setRecorded] = useState<Recorded | undefined>(undefined)
  const [busyPath, setBusyPath] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (path === undefined) return
    const abort = new AbortController()
    setBusyPath(path)
    gitGraph({ path, limit }, abort.signal).then(
      (value) => {
        if (abort.signal.aborted) return
        setRecorded({ path, outcome: { kind: 'value', value } })
        setBusyPath(undefined)
      },
      () => {
        if (abort.signal.aborted) return
        setRecorded({ path, outcome: { kind: 'error' } })
        setBusyPath(undefined)
      },
    )
    return () => { abort.abort() }
  }, [path, limit, refresh, gitGraph])
  return {
    outcome: recorded !== undefined && recorded.path === path ? recorded.outcome : undefined,
    busy: path !== undefined && busyPath === path,
  }
}
