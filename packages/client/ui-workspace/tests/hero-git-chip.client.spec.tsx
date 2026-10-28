// @vitest-environment jsdom
/**
 * The blank-session hero's git chip rendered directly with hand-built props:
 * the branch of the targeted Workspace, the repository name only when it
 * differs from the Workspace chip, and silence without a repository.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceGitInfoValue } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { HeroGitChipProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'
import { HeroGitChip } from '../src/client/status/HeroGitChip.tsx'

afterEach(cleanup)

const t: HeroGitChipProps['t'] = makeTranslate(en, commonEn)
type GitInfo = HeroGitChipProps['gitInfo']

const repoValue = (path: string, repoName: string, branch = 'master', detached = false): WorkspaceGitInfoValue => ({
  path, git: { repoName, root: path, branch, detached },
})

function chip(path: string | undefined, title: string | undefined, gitInfo: GitInfo) {
  return <HeroGitChip {...{ path, title, gitInfo, t } as unknown as HeroGitChipProps} />
}

describe('HeroGitChip', () => {
  it('shows only the branch when the repository name is the Workspace name', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'repform'))
    render(chip('C:\\Users\\dev\\Dev\\repform', 'repform', gitInfo))
    await waitFor(() => { expect(screen.getByText('master')).toBeTruthy() })
    expect(screen.getByTitle(/Git repository/)).toBeTruthy()
    expect(gitInfo).toHaveBeenCalledWith('C:\\Users\\dev\\Dev\\repform', expect.any(AbortSignal))
  })

  it('treats the folder name as the Workspace name when the title was renamed', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'RepForm'))
    render(chip('/work/repform', 'My project', gitInfo))
    await waitFor(() => { expect(screen.getByText('master')).toBeTruthy() })
  })

  it('compares against the folder name alone while the Workspace title is not known yet', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'repform'))
    render(chip('C:\\Users\\dev\\Dev\\repform', undefined, gitInfo))
    await waitFor(() => { expect(screen.getByText('master')).toBeTruthy() })
  })

  it('adds the repository name when it differs from the Workspace name', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'monorepo', 'dev'))
    render(chip('/work/monorepo/apps/web', 'web', gitInfo))
    await waitFor(() => { expect(screen.getByText('monorepo (dev)')).toBeTruthy() })
  })

  it('labels a detached HEAD with the repository name even when it matches', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'repform', 'a1b2c3d', true))
    render(chip('/work/repform', 'repform', gitInfo))
    await waitFor(() => { expect(screen.getByText('repform (a1b2c3d, detached HEAD)')).toBeTruthy() })
  })

  it('looks up again when the targeted Workspace changes and drops the old answer', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'a', path.endsWith('2') ? 'dev' : 'master'))
    const view = render(chip('/w/a1', 'a', gitInfo))
    await waitFor(() => { expect(screen.getByText('master')).toBeTruthy() })
    view.rerender(chip('/w/a2', 'a', gitInfo))
    expect(screen.queryByText('master')).toBeNull()
    await waitFor(() => { expect(screen.getByText('dev')).toBeTruthy() })
  })

  it('renders nothing without a Workspace, outside a repository, or when the lookup fails', async () => {
    const none = vi.fn<GitInfo>()
    const empty = render(chip(undefined, undefined, none))
    expect(empty.container.firstChild).toBeNull()
    expect(none).not.toHaveBeenCalled()
    empty.unmount()

    const outside = vi.fn<GitInfo>(async path => ({ path }))
    const plain = render(chip('/tmp/plain', 'plain', outside))
    await waitFor(() => { expect(outside).toHaveBeenCalled() })
    expect(plain.container.firstChild).toBeNull()
    plain.unmount()

    const failing = vi.fn<GitInfo>(async () => { throw new Error('host down') })
    const broken = render(chip('/tmp/plain', 'plain', failing))
    await waitFor(() => { expect(failing).toHaveBeenCalled() })
    expect(broken.container.firstChild).toBeNull()
  })
})
