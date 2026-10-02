/**
 * Workspace status line: the Session's working directory and, when that
 * directory is inside a git repository, the repository name and branch. It is
 * an ambient entry of `conversation.composer.dock`, so it sits under the
 * composer next to the session stats pills. The directory comes from the
 * Session list row (`cwd`); the git facts come from one Host lookup per cwd,
 * repeated when the Session's running state flips so a branch switched by the
 * agent's own commands shows up when the turn ends.
 */
import { IconBranchOutlineRegular, IconFolderCloseRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceStatusProps } from '../contract/slots.ts'
import { abbreviatePath } from './path-label.ts'
import { useGitRepo } from './use-git-repo.ts'
import css from './WorkspaceStatusLine.module.css'

/**
 * Render the working directory and git repository of the Session.
 * @param props - owner share, locale seat, the Session list hook, and the git lookup callback.
 * @returns the status line, or null while the Session records no directory.
 */
export function WorkspaceStatusLine({ sessionId, useSessions, gitInfo, t }: WorkspaceStatusProps) {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const running = useSessions(sessions => sessions.byId[sessionId]?.running ?? false)
  const repo = useGitRepo(cwd, running, gitInfo)

  if (cwd === undefined) return null
  return (
    <div className={css.root} data-workspace-status>
      <span className={css.item} title={t('statusLine.cwd', { path: cwd })}>
        <IconFolderCloseRegular size={14} />
        <span className={css.label}>{abbreviatePath(cwd)}</span>
      </span>
      {repo !== undefined && (
        <span className={css.item} title={t('statusLine.repo', { root: repo.root })}>
          <IconBranchOutlineRegular size={14} />
          <span className={css.label}>
            {t(repo.detached ? 'statusLine.repoDetached' : 'statusLine.repoBranch', { repo: repo.repoName, branch: repo.branch })}
          </span>
        </span>
      )}
    </div>
  )
}
