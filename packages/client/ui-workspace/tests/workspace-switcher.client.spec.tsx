// @vitest-environment jsdom
/**
 * The header Workspace switcher rendered directly with hand-built props: the
 * label (Workspace title or abbreviated directory) and git branch, the
 * Pinned and Recent groups with their pin toggles, and the move of the
 * Session to the chosen Workspace with every refusal shown in a dialog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceGitInfoValue, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceSwitcherProps, WorkspaceSwitchOutcome } from '../src/client/contract/slots.ts'
import { en, zh } from '../src/client/locales.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { WorkspaceSwitcher } from '../src/client/status/WorkspaceSwitcher.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const sessionId = 'one' as SessionId
const tEn: WorkspaceSwitcherProps['t'] = makeTranslate(en, commonEn)
const tZh: WorkspaceSwitcherProps['t'] = makeTranslate(zh, commonZh)
const wid = (id: string) => id as WorkspaceId
/** One shared empty pin list: the bound hook compares snapshots by identity. */
const NONE: readonly string[] = []

function row(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id: id as SessionId, displayTitle: id, running: false, blank: false, updatedAt: 1, retainedBy: {}, ...overrides }
}

function workspace(id: string, title: string, sessionIds: string[] = []): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title, sessionIds: sessionIds as SessionId[],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const repoValue = (path: string, branch = 'main', detached = false): WorkspaceGitInfoValue => ({
  path, git: { repoName: 'my-repo', root: '/work/my-repo', branch, detached },
})

interface Setup {
  summary?: SessionSummary | undefined
  summaries?: SessionSummary[]
  workspaces?: WorkspaceView[]
  pinned?: string[]
  outcome?: WorkspaceSwitchOutcome
  flowAvailable?: boolean
  t?: WorkspaceSwitcherProps['t']
  gitInfo?: WorkspaceSwitcherProps['gitInfo']
}

/** Mount the switcher over fixed lists and a real viewing store. */
function mountSwitcher(setup: Setup = {}) {
  const summary = 'summary' in setup ? setup.summary : row('one', { cwd: '/projects/alpha' })
  const all = [...(summary === undefined ? [] : [summary]), ...setup.summaries ?? []]
  const list: SessionListState = {
    ids: all.map(item => item.id), byId: Object.fromEntries(all.map(item => [item.id, item])),
    phase: 'ready', projectionsBySession: {},
  }
  const snapshot = {
    items: setup.workspaces ?? [workspace('alpha', 'Alpha', ['one']), workspace('beta', 'Beta'), workspace('gamma', 'Gamma')],
    archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  } as WorkspaceSnapshot
  const instance = createWorkspaceViewStore().create()
  for (const id of setup.pinned ?? []) instance.actions.toggleWorkspacePin(id)
  const switchWorkspace = vi.fn<WorkspaceSwitcherProps['switchWorkspace']>(async () => setup.outcome ?? { status: 'switched' })
  const props = {
    sessionId,
    useSessions: (selector: (state: SessionListState) => unknown) => selector(list),
    useWorkspaces: (selector: (state: WorkspaceSnapshot) => unknown) => selector(snapshot),
    usePinnedWorkspaces: bindSnapshotSelector({
      getSnapshot: () => instance.getSnapshot().pinnedWorkspaceIds ?? NONE,
      subscribe: listener => instance.subscribe(listener),
    }),
    toggleWorkspacePin: instance.actions.toggleWorkspacePin,
    gitInfo: setup.gitInfo ?? vi.fn(async () => ({ path: '' })),
    createWorkspace: vi.fn(),
    switchWorkspace,
    useDirectoryFlow: (selector: (occupied: boolean) => unknown) => selector(setup.flowAvailable ?? false),
    renderSlot: () => null,
    t: setup.t ?? tEn,
  } as unknown as WorkspaceSwitcherProps
  const view = render(<WorkspaceSwitcher {...props} />)
  return { ...view, instance, switchWorkspace, props }
}

const trigger = () => document.querySelector<HTMLButtonElement>('[data-workspace-switcher] button')!

describe('WorkspaceSwitcher label', () => {
  it('renders nothing while the Session records no directory or is missing from the list', () => {
    const recorded = mountSwitcher({ summary: row('one') })
    expect(recorded.container.firstChild).toBeNull()
    recorded.unmount()
    const missing = mountSwitcher({ summary: undefined })
    expect(missing.container.firstChild).toBeNull()
  })

  it('names the Workspace holding the Session and shows its directory in the tooltip', () => {
    mountSwitcher()
    expect(trigger().textContent).toBe('Alpha')
    expect(trigger().title).toBe('Working directory: /projects/alpha. Click to switch workspace')
  })

  it('falls back to the workspace holding the directory, then to the abbreviated directory', () => {
    mountSwitcher({ workspaces: [workspace('alpha', 'Alpha', [])] })
    expect(trigger().textContent).toBe('Alpha')
    cleanup()
    mountSwitcher({ workspaces: [workspace('beta', 'Beta', [])] })
    expect(trigger().textContent).toContain('alpha')
  })

  it('shows the repository branch beside the name, and the detached form', async () => {
    const gitInfo = vi.fn<WorkspaceSwitcherProps['gitInfo']>(async path => repoValue(path))
    mountSwitcher({ gitInfo })
    await waitFor(() => { expect(trigger().textContent).toBe('Alphamy-repo (main)') })
    expect(screen.getByTitle('Git repository: /work/my-repo')).toBeTruthy()
    cleanup()
    mountSwitcher({ gitInfo: async path => repoValue(path, 'a1b2c3d', true) })
    await waitFor(() => { expect(trigger().textContent).toContain('a1b2c3d') })
  })

  it('looks up the repository again when the Session stops running', async () => {
    const gitInfo = vi.fn<WorkspaceSwitcherProps['gitInfo']>(async path => repoValue(path))
    const first = mountSwitcher({ summary: row('one', { cwd: '/projects/alpha', running: true }), gitInfo })
    await waitFor(() => { expect(gitInfo).toHaveBeenCalledOnce() })
    first.unmount()
    mountSwitcher({ summary: row('one', { cwd: '/projects/alpha', running: false }), gitInfo })
    await waitFor(() => { expect(gitInfo).toHaveBeenCalledTimes(2) })
  })

  it('shows only the Workspace when the repository lookup fails, and ignores answers that arrive after unmount', async () => {
    const failing = vi.fn<WorkspaceSwitcherProps['gitInfo']>(async () => { throw new Error('host down') })
    mountSwitcher({ gitInfo: failing })
    await waitFor(() => { expect(failing).toHaveBeenCalled() })
    expect(trigger().textContent).toBe('Alpha')
    cleanup()

    let release!: (value: WorkspaceGitInfoValue) => void
    let seen!: AbortSignal
    const slow = vi.fn<WorkspaceSwitcherProps['gitInfo']>((_path, signal) => {
      seen = signal
      return new Promise<WorkspaceGitInfoValue>((resolve) => { release = resolve })
    })
    mountSwitcher({ gitInfo: slow }).unmount()
    expect(seen.aborted).toBe(true)
    await act(async () => { release(repoValue('/projects/alpha')) })
    cleanup()

    let fail!: (reason: Error) => void
    const lost = vi.fn<WorkspaceSwitcherProps['gitInfo']>(() => new Promise<WorkspaceGitInfoValue>((_resolve, reject) => { fail = reject }))
    mountSwitcher({ gitInfo: lost }).unmount()
    await act(async () => { fail(new Error('late failure')) })
    expect(document.querySelector('[data-workspace-switcher]')).toBeNull()
  })

  it('treats a Workspace Session missing from the Session list as never used', () => {
    mountSwitcher({ workspaces: [workspace('alpha', 'Alpha', ['one']), workspace('delta', 'Delta', ['ghost'])] })
    fireEvent.click(trigger())
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Alpha', 'Delta'])
  })

  it('speaks Chinese when the locale seat is Chinese', () => {
    mountSwitcher({ t: tZh })
    expect(trigger().title).toBe('工作目录：/projects/alpha。点击切换工作区')
  })
})

describe('WorkspaceSwitcher list', () => {
  const items = () => screen.getAllByRole('menuitem').map(item => item.textContent)

  it('lists pinned Workspaces first, then recent ones ordered by their latest Session', () => {
    mountSwitcher({
      pinned: ['gamma'],
      workspaces: [workspace('alpha', 'Alpha', ['one']), workspace('beta', 'Beta', ['b1']), workspace('gamma', 'Gamma', ['g1']), workspace('delta', 'Delta')],
      summaries: [row('b1', { updatedAt: 50 }), row('g1', { updatedAt: 99 })],
    })
    fireEvent.click(trigger())
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText('Recent')).toBeTruthy()
    expect(items()).toEqual(['Gamma', 'Beta', 'Alpha', 'Delta'])
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('omits a group with no Workspace', () => {
    mountSwitcher()
    fireEvent.click(trigger())
    expect(screen.queryByText('Pinned')).toBeNull()
    expect(screen.getByText('Recent')).toBeTruthy()
  })

  it('ignores a pinned id whose Workspace is gone', () => {
    mountSwitcher({ pinned: ['vanished'] })
    fireEvent.click(trigger())
    expect(screen.queryByText('Pinned')).toBeNull()
  })

  it('pins and unpins from a row without choosing it', () => {
    const { instance, switchWorkspace } = mountSwitcher()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: 'Pin "Beta"' }))
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual(['beta'])
    expect(switchWorkspace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Unpin "Beta"' }))
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual([])
  })

  it('closes the list on Escape', () => {
    mountSwitcher()
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('offers adding a Workspace only when a directory flow is composed', () => {
    mountSwitcher({ flowAvailable: true })
    fireEvent.click(trigger())
    expect(screen.getByRole('menuitem', { name: 'Add workspace…' })).toBeTruthy()
  })
})

describe('WorkspaceSwitcher move', () => {
  it('moves the Session to the chosen Workspace and closes the list', async () => {
    const { switchWorkspace } = mountSwitcher()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(switchWorkspace).toHaveBeenCalledWith(sessionId, 'beta')
    expect(trigger().disabled).toBe(true)
    await waitFor(() => { expect(trigger().disabled).toBe(false) })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does nothing when the current Workspace is chosen again', () => {
    const { switchWorkspace } = mountSwitcher()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(switchWorkspace).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    [{ status: 'busy' }, 'This session still has running work. Stop it first, then switch workspace.'],
    [{ status: 'in-use' }, 'Another running FORGE (such as another dsh web or the desktop app) is using this session. Quit it and try again.'],
    [{ status: 'failed', message: 'fork refused' }, 'fork refused'],
  ] as const)('explains a refused switch (%j) in a dialog and keeps the Session where it was', async (outcome, message) => {
    mountSwitcher({ outcome })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    const dialog = await screen.findByRole('dialog', { name: 'Could not switch workspace' })
    expect(dialog.textContent).toContain(message)
    // The dialog closes through its own Close button and through Escape.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    await screen.findByRole('dialog', { name: 'Could not switch workspace' })
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(trigger().textContent).toBe('Alpha')
  })
})
