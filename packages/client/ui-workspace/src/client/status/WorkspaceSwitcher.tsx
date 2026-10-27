/**
 * Header Workspace switcher: an entry of `conversation.session.header.actions`
 * that names the Session's working directory (and, inside a git repository,
 * its branch) beside the title. Clicking it opens the Workspaces the user has
 * pinned and used recently, plus Open to adopt a new directory; choosing one
 * moves the Session there. The git facts come from one Host lookup per
 * directory, repeated when the Session's running state flips so a branch
 * switched by the agent's own commands shows up when the turn ends.
 */
import { useRef, useState } from 'react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import {
  Button, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconFolderCloseRegular, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceSwitcherProps } from '../contract/slots.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import { abbreviatePath } from './path-label.ts'
import { useGitRepo } from './use-git-repo.ts'
import css from './WorkspaceSwitcher.module.css'

/** How many unpinned Workspaces the Recent group lists. */
const RECENT_LIMIT = 8

/**
 * Render the switcher button and its pick flow.
 * @param props - owner share, Workspace, Session and pin hooks, the injected Host callbacks, and the locale seat.
 * @returns the switcher, or null while the Session records no directory.
 */
export function WorkspaceSwitcher({
  sessionId, useSessions, useWorkspaces, usePinnedWorkspaces, toggleWorkspacePin, gitInfo, createWorkspace,
  switchWorkspace, useDirectoryFlow, renderSlot, t,
}: WorkspaceSwitcherProps) {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const running = useSessions(sessions => sessions.byId[sessionId]?.running ?? false)
  const summaries = useSessions(sessions => sessions.byId)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const pinned = usePinnedWorkspaces(ids => ids)
  const repo = useGitRepo(cwd, running, gitInfo)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (cwd === undefined) return null
  const current = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
    ?? workspaces.find(workspace => workspace.path === cwd)
  const pinnedIds = pinned as readonly WorkspaceId[]
  const recentIds = workspaces
    .filter(workspace => !pinnedIds.includes(workspace.workspaceId))
    .map(workspace => ({
      id: workspace.workspaceId,
      lastUsed: Math.max(0, ...workspace.sessionIds.map(id => summaries[id]?.updatedAt ?? 0)),
    }))
    .sort((left, right) => right.lastUsed - left.lastUsed)
    .slice(0, RECENT_LIMIT)
    .map(entry => entry.id)
  const label = current === undefined
    ? abbreviatePath(cwd)
    : workspaceDisplayTitle(current.title, t('workspace.defaultName'))

  const move = (workspaceId: WorkspaceId): void => {
    setOpen(false)
    if (workspaceId === current?.workspaceId) return
    setMoving(true)
    switchWorkspace(sessionId, workspaceId).then((outcome) => {
      setMoving(false)
      if (outcome.status === 'busy') setError(t('switchWorkspace.busy'))
      else if (outcome.status === 'in-use') setError(t('deleteSession.inUse'))
      else if (outcome.status === 'failed') setError(outcome.message)
    })
  }

  return (
    <div className={css.root} data-workspace-switcher>
      <button
        ref={anchorRef}
        type="button"
        className={css.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={moving}
        title={t('switcher.title', { path: cwd })}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconFolderCloseRegular size={14} />
        <span className={css.label}>{label}</span>
        {repo !== undefined && (
          <span className={css.branch} title={t('statusLine.repo', { root: repo.root })}>
            <IconBranchOutlineRegular size={14} />
            <span className={css.label}>
              {t(repo.detached ? 'statusLine.repoDetached' : 'statusLine.repoBranch', { repo: repo.repoName, branch: repo.branch })}
            </span>
          </span>
        )}
        <IconChevronDownOutlineRegular size={12} />
      </button>
      <WorkspacePickFlow
        t={t}
        open={open}
        anchorRef={anchorRef}
        useWorkspaces={useWorkspaces}
        createWorkspace={createWorkspace}
        useDirectoryFlow={useDirectoryFlow}
        renderDirectoryFlow={owner => renderSlot('conversation.session.header.workspace.directoryFlow', owner)}
        selectedId={current?.workspaceId}
        sections={{ pinnedIds, recentIds, onTogglePin: toggleWorkspacePin }}
        onPick={move}
        onClose={() => { setOpen(false) }}
      />
      <Modal
        open={error !== null}
        onClose={() => { setError(null) }}
        closeLabel={t('close')}
        title={t('switcher.errorTitle')}
        footer={<Button variant="outline" onClick={() => { setError(null) }}>{t('close')}</Button>}
      >
        <div role="alert">{error}</div>
      </Modal>
    </div>
  )
}
