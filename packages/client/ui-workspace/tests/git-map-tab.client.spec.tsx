// @vitest-environment jsdom
/**
 * The Git Map tab rendered directly with hand-built props: the directory from
 * the Session list row, the history from the injected Host lookup, every
 * state the lookup can settle on, and the repeat reads (refresh, station
 * limit, directory change, running flip).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceGitGraph, WorkspaceGitGraphCommit, WorkspaceGitGraphValue,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GitMapTab, GitMapTitle, type GitMapTabProps } from '../src/client/git-map/GitMapTab.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sessionId = 'one' as SessionId
const tEn: GitMapTabProps['t'] = makeTranslate(en, commonEn)
const tZh: GitMapTabProps['t'] = makeTranslate(zh, commonZh)

function row(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sessionId, displayTitle: 'one', running: false, blank: false, updatedAt: 1, retainedBy: {}, ...overrides,
  }
}

type GitGraphLookup = GitMapTabProps['gitGraph']

function propsFor(summary: SessionSummary, gitGraph: GitGraphLookup, t: GitMapTabProps['t'] = tEn): GitMapTabProps {
  const list: SessionListState = {
    ids: [summary.id], byId: { [summary.id]: summary }, phase: 'ready', projectionsBySession: {},
  }
  const useSessions = (selector: (state: SessionListState) => unknown) => selector(list)
  return { sessionId, useSessions, gitGraph, t } as unknown as GitMapTabProps
}

function commit(id: string, type: WorkspaceGitGraphCommit['type']): WorkspaceGitGraphCommit {
  return { hash: id.padEnd(40, '0'), short: id.slice(0, 7), type, message: `${type}: ${id}`, date: '2026-01-10', author: 'Ada' }
}

const HEAD = commit('open-1', 'fix')

function graphValue(path: string, overrides: Partial<WorkspaceGitGraph> = {}): WorkspaceGitGraphValue {
  return {
    path,
    state: 'ready',
    graph: {
      repoName: 'my-repo', root: path, base: 'main', head: HEAD.hash, headBranch: 'feat/open', total: 12, merges: 1,
      stations: [
        {
          hash: 'aaaaaaa'.padEnd(40, '0'), short: 'aaaaaaa', kind: 'commit', type: 'other', date: '2026-01-10',
          message: 'chore: init', author: 'Ada', label: 'aaaaaaa', name: 'init', commits: [], commitCount: 0,
        },
        {
          hash: 'bbbbbbb'.padEnd(40, '0'), short: 'bbbbbbb', kind: 'merge', type: 'merge', date: '2026-01-11',
          message: 'Merge pull request #7 from user/feat/alpha', author: 'Ada', label: '#7', name: 'alpha',
          commits: [commit('b1', 'feat')], commitCount: 4,
        },
      ],
      branches: [{ name: 'feat/open', aliases: 0, commits: [commit('open-0', 'feat'), HEAD], commitCount: 12, isHead: true }],
      moreBranches: 2,
      ...overrides,
    },
  }
}

const lookup = (value: WorkspaceGitGraphValue | ((path: string) => WorkspaceGitGraphValue)) =>
  vi.fn<GitGraphLookup>(async request => typeof value === 'function' ? value(request.path) : value)

describe('GitMapTab', () => {
  it('asks for nothing while the Session records no directory', () => {
    const gitGraph = vi.fn<GitGraphLookup>()
    render(<GitMapTab {...propsFor(row(), gitGraph)} />)
    expect(screen.getByText('This session has no working directory.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh' }).disabled).toBe(true)
    expect(gitGraph).not.toHaveBeenCalled()
  })

  it('shows a loading note, then the map of the repository', async () => {
    const gitGraph = lookup(path => graphValue(path))
    const signal: unknown = expect.any(AbortSignal)
    render(<GitMapTab {...propsFor(row({ cwd: '/work/my-repo' }), gitGraph)} />)
    expect(screen.getByText('Reading git history…')).toBeTruthy()
    expect(gitGraph).toHaveBeenCalledWith({ path: '/work/my-repo', limit: 18 }, signal)

    expect(await screen.findByRole('img', { name: 'Git history map of my-repo' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'my-repo' })).toBeTruthy()
    expect(screen.getByText('Main line main')).toBeTruthy()
    expect(screen.getByText('On feat/open')).toBeTruthy()
    expect(screen.getByText('Commits: 12 · Merges: 1')).toBeTruthy()
    // Two open branches are left out of the six listed: one drawn plus the two the Host counted.
    expect(screen.getByText('Stations shown: 2 · Open branches: 3')).toBeTruthy()
    expect(document.querySelectorAll('[data-git-station]')).toHaveLength(2)
    expect(document.querySelector('[data-git-branch="feat/open"]')?.textContent).toContain('feat/open (+10) ← you are here')
    expect(screen.getByText('2 more open branches not shown')).toBeTruthy()
    expect(screen.getByText('#7')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(document.querySelector('title')).not.toBeNull()
    // Hover text names hash, subject and author.
    expect(screen.getByText('open-1 · fix: open-1 (Ada)')).toBeTruthy()
    expect(screen.getByText('bbbbbbb · Merge pull request #7 from user/feat/alpha (4 commits on the branch)')).toBeTruthy()
    // Legend counts come from what is drawn: feat = merge commit + branch commit, fix = head, other = the init commit.
    expect(screen.getByText('feature 2')).toBeTruthy()
    expect(screen.getByText('fix 1')).toBeTruthy()
    expect(screen.getByText('chore / other 1')).toBeTruthy()
    expect(screen.getByText('merge (station) 1')).toBeTruthy()
    expect(document.querySelector('[data-git-map]')?.getAttribute('aria-busy')).toBe('false')
  })

  it('renders in Chinese and says the singular when one open branch is left out', async () => {
    const gitGraph = lookup(path => graphValue(path, { moreBranches: 1 }))
    render(<GitMapTab {...propsFor(row({ cwd: '/work/my-repo' }), gitGraph, tZh)} />)
    expect(await screen.findByRole('img', { name: 'my-repo 的 Git 历史地图' })).toBeTruthy()
    expect(screen.getByText('另有 1 条未合并分支未显示')).toBeTruthy()
    expect(screen.getByText('主线 main')).toBeTruthy()
  })

  it.each([
    ['no-repository', "This session's folder is not inside a git repository."],
    ['no-commits', 'This repository has no commits yet.'],
  ] as const)('explains the %s state', async (state, copy) => {
    const gitGraph = lookup({ path: '/work/plain', state })
    render(<GitMapTab {...propsFor(row({ cwd: '/work/plain' }), gitGraph)} />)
    expect(await screen.findByText(copy)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('offers a retry when git failed, and when the Host lookup itself is refused', async () => {
    const gitGraph = vi.fn<GitGraphLookup>()
    gitGraph.mockResolvedValueOnce({ path: '/work/r', state: 'failed' })
    render(<GitMapTab {...propsFor(row({ cwd: '/work/r' }), gitGraph)} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not read the history (git failed or timed out).')

    gitGraph.mockRejectedValueOnce(new Error('lost'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => { expect(gitGraph).toHaveBeenCalledTimes(2) })
    expect(await screen.findByRole('alert')).toBeTruthy()

    gitGraph.mockResolvedValueOnce(graphValue('/work/r'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('img')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a ready answer without a graph as a failure', async () => {
    const gitGraph = lookup({ path: '/work/odd', state: 'ready' })
    render(<GitMapTab {...propsFor(row({ cwd: '/work/odd' }), gitGraph)} />)
    expect(await screen.findByText('Could not read the history (git failed or timed out).')).toBeTruthy()
  })

  it('reads again for the other station count and on refresh, keeping the map up meanwhile', async () => {
    const gitGraph = lookup(path => graphValue(path))
    render(<GitMapTab {...propsFor(row({ cwd: '/work/my-repo' }), gitGraph)} />)
    await screen.findByRole('img')

    fireEvent.change(screen.getByRole('combobox', { name: 'Stations shown' }), { target: { value: '40' } })
    await waitFor(() => {
      expect(gitGraph).toHaveBeenLastCalledWith({ path: '/work/my-repo', limit: 40 }, expect.any(AbortSignal))
    })
    expect(screen.getByRole('img')).toBeTruthy()
    await waitFor(() => { expect(document.querySelector('[data-git-map]')?.getAttribute('aria-busy')).toBe('false') })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => { expect(gitGraph).toHaveBeenCalledTimes(3) })
    expect(gitGraph).toHaveBeenLastCalledWith({ path: '/work/my-repo', limit: 40 }, expect.any(AbortSignal))

    fireEvent.change(screen.getByRole('combobox', { name: 'Stations shown' }), { target: { value: '18' } })
    await waitFor(() => { expect(gitGraph).toHaveBeenCalledTimes(4) })
    expect(gitGraph).toHaveBeenLastCalledWith({ path: '/work/my-repo', limit: 18 }, expect.any(AbortSignal))
  })

  it('reads again when the Session starts or stops running and when its directory changes', async () => {
    const gitGraph = lookup(path => graphValue(path))
    const view = render(<GitMapTab {...propsFor(row({ cwd: '/work/a' }), gitGraph)} />)
    await screen.findByRole('img')
    expect(gitGraph).toHaveBeenCalledTimes(1)

    view.rerender(<GitMapTab {...propsFor(row({ cwd: '/work/a', running: true }), gitGraph)} />)
    await waitFor(() => { expect(gitGraph).toHaveBeenCalledTimes(2) })

    // Another directory never shows the previous directory's answer.
    let release: (value: WorkspaceGitGraphValue) => void = () => {}
    gitGraph.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    view.rerender(<GitMapTab {...propsFor(row({ cwd: '/work/b', running: true }), gitGraph)} />)
    expect(await screen.findByText('Reading git history…')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    await act(async () => { release(graphValue('/work/b')) })
    expect(await screen.findByRole('img')).toBeTruthy()
  })

  it('drops an answer that arrives after the tab unmounted', async () => {
    let release: (value: WorkspaceGitGraphValue) => void = () => {}
    const gitGraph = vi.fn<GitGraphLookup>(() => new Promise((resolve) => { release = resolve }))
    const view = render(<GitMapTab {...propsFor(row({ cwd: '/work/slow' }), gitGraph)} />)
    const signal = gitGraph.mock.calls[0]![1]
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { release(graphValue('/work/slow')) })
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('opens scrolled to the newest history, at the right', async () => {
    let scrolled = -1
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900)
    vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation((value) => { scrolled = value })
    render(<GitMapTab {...propsFor(row({ cwd: '/work/my-repo' }), lookup(path => graphValue(path)))} />)
    await screen.findByRole('img')
    expect(scrolled).toBe(900)
  })
})

const titleProps = (t: GitMapTabProps['t']): Parameters<typeof GitMapTitle>[0] => ({ t }) as unknown as Parameters<typeof GitMapTitle>[0]

describe('GitMapTitle', () => {
  it('renders the tab chip text in the reader language', () => {
    render(<GitMapTitle {...titleProps(tEn)} />)
    expect(screen.getByText('Git Map')).toBeTruthy()
    cleanup()
    render(<GitMapTitle {...titleProps(tZh)} />)
    expect(screen.getByText('Git 地图')).toBeTruthy()
  })
})
