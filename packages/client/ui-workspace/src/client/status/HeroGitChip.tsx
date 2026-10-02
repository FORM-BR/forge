/**
 * Git chip of the blank-session hero: the branch of the Workspace the hero
 * targets, beside the Workspace chip. The repository name appears only when
 * it differs from what the Workspace chip already shows (the Workspace title
 * or the folder name). Nothing renders without a Workspace or outside a
 * repository.
 */
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroGitChipProps } from '../contract/slots.ts'
import { useGitRepo } from './use-git-repo.ts'
import css from './WorkspaceStatusLine.module.css'

/**
 * Render the branch chip for the hero's chosen Workspace.
 * @param props - owner share (Workspace directory and title), locale seat, and the git lookup callback.
 * @returns the chip, or null without a Workspace or repository.
 */
export function HeroGitChip({ path, title, gitInfo, t }: HeroGitChipProps) {
  const repo = useGitRepo(path, undefined, gitInfo)
  if (repo === undefined || path === undefined) return null
  // The Workspace chip shows the title, or the folder name while the list loads.
  const known = [title, path.split(/[\\/]/).at(-1)]
  const sameName = known.some(name => name?.toLowerCase() === repo.repoName.toLowerCase())
  const label = repo.detached
    ? t('statusLine.repoDetached', { repo: repo.repoName, branch: repo.branch })
    : sameName ? repo.branch : t('statusLine.repoBranch', { repo: repo.repoName, branch: repo.branch })
  return (
    <span className={css.heroChip} title={t('statusLine.repo', { root: repo.root })} data-hero-git>
      <IconBranchOutlineRegular size={14} />
      <span className={css.label}>{label}</span>
    </span>
  )
}
