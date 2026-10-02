// @vitest-environment jsdom
/**
 * The workspace status line rendered directly with hand-built props: the
 * working directory from the Session list row, the repository and branch from
 * the injected Host lookup, and the refresh when the Session's running state
 * flips or its directory changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceGitInfoValue } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceStatusProps } from '../src/client/contract/slots.ts'
import { en, zh } from '../src/client/locales.ts'
import { WorkspaceStatusLine } from '../src/client/status/WorkspaceStatusLine.tsx'

afterEach(cleanup)

const sessionId = 'one' as SessionId
const tEn: WorkspaceStatusProps['t'] = makeTranslate(en, commonEn)
const tZh: WorkspaceStatusProps['t'] = makeTranslate(zh, commonZh)

function row(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sessionId, displayTitle: 'one', running: false, blank: false, updatedAt: 1, retainedBy: {}, ...overrides,
  }
}

function listOf(summary: SessionSummary): SessionListState {
  return { ids: [summary.id], byId: { [summary.id]: summary }, phase: 'ready', projectionsBySession: {} }
}

type GitInfo = WorkspaceStatusProps['gitInfo']

/** Props over a fixed Session list; `useSessions` selects from it like the bound global hook. */
function propsFor(
  summary: SessionSummary | undefined,
  gitInfo: GitInfo,
  t: WorkspaceStatusProps['t'] = tEn,
): WorkspaceStatusProps {
  const list: SessionListState = summary === undefined
    ? { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }
    : listOf(summary)
  const useSessions = (selector: (state: SessionListState) => unknown) => selector(list)
  return { sessionId, useSessions, gitInfo, t } as unknown as WorkspaceStatusProps
}

const repoValue = (path: string, branch = 'main', detached = false): WorkspaceGitInfoValue => ({
  path, git: { repoName: 'my-repo', root: '/work/my-repo', branch, detached },
})

describe('WorkspaceStatusLine', () => {
  it('renders nothing while the Session records no directory or is missing from the list', () => {
    const gitInfo = vi.fn<GitInfo>()
    const recorded = render(<WorkspaceStatusLine {...propsFor(row(), gitInfo)} />)
    expect(recorded.container.firstChild).toBeNull()
    recorded.unmount()
    const missing = render(<WorkspaceStatusLine {...propsFor(undefined, gitInfo)} />)
    expect(missing.container.firstChild).toBeNull()
    expect(gitInfo).not.toHaveBeenCalled()
  })

  it('shows the directory at once and the repository and branch when the lookup answers', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path))
    render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/work/my-repo/src' }), gitInfo)} />)
    expect(screen.getByText('/work/my-repo/src')).toBeTruthy()
    expect(screen.getByTitle('Working directory: /work/my-repo/src')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('my-repo (main)')).toBeTruthy() })
    expect(screen.getByTitle('Git repository: /work/my-repo')).toBeTruthy()
    expect(gitInfo).toHaveBeenCalledWith('/work/my-repo/src', expect.any(AbortSignal))
  })

  it('labels a detached HEAD and localizes the copy', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, 'a1b2c3d', true))
    render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/work/my-repo' }), gitInfo, tZh)} />)
    await waitFor(() => { expect(screen.getByText('my-repo（a1b2c3d，游离 HEAD）')).toBeTruthy() })
    expect(screen.getByTitle('工作目录：/work/my-repo')).toBeTruthy()
  })

  it('shows only the directory outside a repository or when the lookup fails', async () => {
    const outside = vi.fn<GitInfo>(async path => ({ path }))
    const view = render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/tmp/plain' }), outside)} />)
    await waitFor(() => { expect(outside).toHaveBeenCalled() })
    expect(screen.queryByTitle(/Git repository/)).toBeNull()
    view.unmount()

    const failing = vi.fn<GitInfo>(async () => { throw new Error('host down') })
    render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/tmp/plain' }), failing)} />)
    await waitFor(() => { expect(failing).toHaveBeenCalled() })
    expect(screen.getByText('/tmp/plain')).toBeTruthy()
    expect(screen.queryByTitle(/Git repository/)).toBeNull()
  })

  it('looks up again when the running state flips and drops a stale answer when the directory changes', async () => {
    const gitInfo = vi.fn<GitInfo>(async path => repoValue(path, path.endsWith('b') ? 'dev' : 'main'))
    const view = render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/w/a' }), gitInfo)} />)
    await waitFor(() => { expect(screen.getByText('my-repo (main)')).toBeTruthy() })

    view.rerender(<WorkspaceStatusLine {...propsFor(row({ cwd: '/w/a', running: true }), gitInfo)} />)
    await waitFor(() => { expect(gitInfo).toHaveBeenCalledTimes(2) })

    view.rerender(<WorkspaceStatusLine {...propsFor(row({ cwd: '/w/b', running: true }), gitInfo)} />)
    expect(screen.queryByText('my-repo (main)')).toBeNull()
    await waitFor(() => { expect(screen.getByText('my-repo (dev)')).toBeTruthy() })
  })

  it('aborts the pending lookup when the line unmounts and ignores its late answer', async () => {
    let release!: (value: WorkspaceGitInfoValue) => void
    let seen!: AbortSignal
    const gitInfo = vi.fn<GitInfo>((_path, signal) => {
      seen = signal
      return new Promise<WorkspaceGitInfoValue>((resolve) => { release = resolve })
    })
    const view = render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/w/a' }), gitInfo)} />)
    view.unmount()
    expect(seen.aborted).toBe(true)
    await act(async () => { release(repoValue('/w/a')) })
    expect(screen.queryByText('my-repo (main)')).toBeNull()
  })

  it('ignores a lookup failure that arrives after the line unmounted', async () => {
    let fail!: (reason: Error) => void
    const gitInfo = vi.fn<GitInfo>(() => new Promise<WorkspaceGitInfoValue>((_resolve, reject) => { fail = reject }))
    const view = render(<WorkspaceStatusLine {...propsFor(row({ cwd: '/w/a' }), gitInfo)} />)
    view.unmount()
    await act(async () => { fail(new Error('late failure')) })
    expect(screen.queryByText('/w/a')).toBeNull()
  })
})
