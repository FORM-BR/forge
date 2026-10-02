/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionActivity, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
export type {
  SessionActivity, SessionActivityItem, SessionActivityKind, SessionActivityKindMap,
} from '@deepseek-ai/dsh-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Git repository containing a directory. */
export interface WorkspaceGitRepo {
  /** Final segment of the repository's top-level directory. */
  readonly repoName: string
  /** Host path of the repository's top-level directory, as git reports it. */
  readonly root: string
  /** Checked-out branch name, or the abbreviated commit when HEAD is detached. */
  readonly branch: string
  /** True when HEAD points at a commit rather than a branch. */
  readonly detached: boolean
}

/** Answer to a git lookup for one directory. */
export interface WorkspaceGitInfoValue {
  /** The directory the lookup was about, echoed from the request. */
  readonly path: string
  /** Absent when the directory is outside a repository or git is unavailable. */
  readonly git?: WorkspaceGitRepo
}

/** Request for the commit history of the repository containing a directory. */
export interface WorkspaceGitGraphRequest {
  /** Fully qualified Host directory, typically a Session's cwd. */
  readonly path: string
  /** Most recent first-parent stations to read from the base branch; clamped to 1..100, default 18. */
  readonly limit?: number
}

/** Conventional-commit class of one commit: `feat`, `fix`, or anything else. */
export type WorkspaceGitGraphCommitType = 'feat' | 'fix' | 'other'

/** One commit shown as a dot on the map. */
export interface WorkspaceGitGraphCommit {
  /** Full object name. */
  readonly hash: string
  /** Abbreviated object name (seven characters). */
  readonly short: string
  readonly type: WorkspaceGitGraphCommitType
  /** Subject line. */
  readonly message: string
  /** Author date as `YYYY-MM-DD`. */
  readonly date: string
  readonly author: string
}

/** One step along the base branch's first-parent chain: a merge (station) or a direct commit. */
export interface WorkspaceGitGraphStation {
  readonly hash: string
  readonly short: string
  /** `merge` when the commit has more than one parent. */
  readonly kind: 'merge' | 'commit'
  /** `merge` for merges, otherwise the commit's own class. */
  readonly type: WorkspaceGitGraphCommitType | 'merge'
  /** Author date as `YYYY-MM-DD`. */
  readonly date: string
  readonly message: string
  readonly author: string
  /** `#<number>` when the subject names a pull request, otherwise the abbreviated hash. */
  readonly label: string
  /** Merged branch name, or the subject stripped of its type prefix and pull-request suffix. */
  readonly name: string
  /** The newest (up to three) non-merge commits of the merged branch, oldest first; empty for a direct commit. */
  readonly commits: readonly WorkspaceGitGraphCommit[]
  /** Number of non-merge commits the merge brought in. */
  readonly commitCount: number
}

/** A branch not yet merged into the base branch. */
export interface WorkspaceGitGraphBranch {
  /** Local name when one exists, otherwise the remote-tracking name. */
  readonly name: string
  /** Further refs pointing at the same commit. */
  readonly aliases: number
  /** The newest (up to twelve) non-merge commits beyond the base branch, oldest first. */
  readonly commits: readonly WorkspaceGitGraphCommit[]
  /** Number of non-merge commits beyond the base branch. */
  readonly commitCount: number
  /** True when the checked-out commit is on this branch. */
  readonly isHead: boolean
}

/** The history of one repository, shaped for the Git Map. */
export interface WorkspaceGitGraph {
  readonly repoName: string
  /** Host path of the repository's top-level directory. */
  readonly root: string
  /** The branch whose first-parent chain forms the main line (`main`, `master`, or the remote default). */
  readonly base: string
  /** Full object name of the checked-out commit. */
  readonly head: string
  /** Checked-out branch name, or `HEAD` when detached. */
  readonly headBranch: string
  /** Commits reachable from any ref. */
  readonly total: number
  /** Merge commits reachable from any ref. */
  readonly merges: number
  /** Main-line steps, oldest first. */
  readonly stations: readonly WorkspaceGitGraphStation[]
  /** Unmerged branches, newest first, at most six; stacked branches appear once. */
  readonly branches: readonly WorkspaceGitGraphBranch[]
  /** Unmerged branches beyond those listed. */
  readonly moreBranches: number
}

/**
 * Answer to a git history lookup for one directory: `ready` carries the graph;
 * the other states say why there is none.
 */
export interface WorkspaceGitGraphValue {
  /** The directory the lookup was about, echoed from the request. */
  readonly path: string
  /** `no-repository`: not inside git (or git is missing); `no-commits`: unborn branch; `failed`: git errored or the deadline expired. */
  readonly state: 'ready' | 'no-repository' | 'no-commits' | 'failed'
  /** Present exactly when `state` is `ready`. */
  readonly graph?: WorkspaceGitGraph
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested directory cannot back a Workspace. */
    'workspace/invalid-path': { readonly path: string }
    /** Another Workspace already uses the requested name. */
    'workspace/name-conflict': { readonly name: string }
    /**
     * The Session still has running work — its own turn, a subagent, a
     * background job, or an active schedule — so archiving was refused
     * without a write; `activity` names what must stop first.
     */
    'workspace/session-active': {
      readonly sessionId: SessionId
      readonly activity: readonly SessionActivity[]
    }
    /**
     * Another writer, for example another running FORGE process, still owns
     * the Session, so deleting it was refused and nothing was removed.
     */
    'workspace/session-in-use': { readonly sessionId: SessionId }
    /** The Session or its anchor is not in the Workspace's manual order. */
    'workspace/move-invalid': {
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
      readonly beforeSessionId?: SessionId
    }
    /** The verb needs an interaction the composed backend does not serve. */
    'directory-picker/unavailable': { readonly capability: string }
    /** The target is not fully qualified, or the backend cannot list it. */
    'directory-picker/unreadable': { readonly path: string }
    /** A child of that name is already there. */
    'directory-picker/exists': { readonly path: string }
    /** The parent is not fully qualified, the name is not one segment, or creation failed. */
    'directory-picker/create-failed': { readonly path: string }
    /** The requested directory is not inside a git repository. */
    'workspace/not-a-repository': { readonly path: string }
    /** git refused to create the worktree, or its parent directory is unwritable. */
    'workspace/worktree-failed': { readonly path: string }
  }
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** New worktree requested beside the repository containing `cwd`. */
export interface WorkspaceWorktreeRequest {
  /** Directory inside the repository; git resolves the repository root from it. */
  readonly cwd: string
  /** Task title that names the directory and branch. */
  readonly title: string
}

/** Created worktree checkout. */
export interface WorkspaceWorktreeValue {
  /** Fully qualified worktree directory. */
  readonly path: string
  /** New branch checked out in the worktree. */
  readonly branch: string
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
  /**
   * Stop the Session's running work — its turn, subagent descendants, owned
   * background jobs, and active schedules — instead of refusing the archive
   * as `workspace/session-active`. The stops are requested before the
   * archive write and are not awaited; the response arrives once the archive
   * set is durable.
   */
  readonly stopActivity?: boolean
}

/** Session requested for permanent deletion from Workspace grouping surfaces. */
export interface WorkspaceDeleteSessionRequest {
  readonly sessionId: SessionId
  /**
   * Stop the Session's running work instead of refusing the deletion as
   * `workspace/session-active`. The stops are requested before the Agent is
   * released and the stored Session is removed.
   */
  readonly stopActivity?: boolean
}

/** Receipt after one Session was permanently deleted. */
export interface WorkspaceDeleteSessionValue {
  readonly deleted: true
}

/** Session requested for restoration from the archived Session list. */
export interface WorkspaceUnarchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Session requested for pinning ahead of unpinned Sessions on grouping surfaces. */
export interface WorkspacePinSessionRequest {
  readonly sessionId: SessionId
}

/** Session requested for removal from the pin set. */
export interface WorkspaceUnpinSessionRequest {
  readonly sessionId: SessionId
}

/** Complete pinned Session set after a mutation, most recently pinned first. */
export interface WorkspacePinValue {
  readonly pinnedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
  /** Registry-global pin set, most recently pinned first. */
  readonly pinnedSessionIds: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }
  | { readonly type: 'pinned'; readonly pinnedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement
