// @vitest-environment jsdom
/**
 * The switch-workspace action rendered directly with hand-built props: the
 * menu row that raises the request and the `shell.overlay` dialog that lists
 * the other Workspaces and moves the Session to the chosen one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { GlobalStandardProps, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type {
  MenuOpenState, WorkspaceSwitchDialogInjected, WorkspaceSwitchOutcome, WorkspaceSwitchRequest,
} from '../src/client/contract/slots.ts'
import { SwitchWorkspaceMenuItem, WorkspaceSwitchDialog } from '../src/client/session-actions/SwitchWorkspace.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is workspace ∪ common; the stub mirrors the real
// lookup chain (namespace, then common vocabulary, then the key).
const t: PropsLocale<'workspace'>['t'] = makeTranslate(zh, commonZh)
const tEn: PropsLocale<'workspace'>['t'] = makeTranslate(en, commonEn)

const sid = (id: string) => id as SessionId
/** Selector hook over one fixed snapshot: how the renderer binds a standard or injected `hooks` source. */
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/** The row every action is rendered for: its owner share as the browser passes it. */
const ROW = { sessionId: sid('one'), displayTitle: 'Session title' }
const one: SessionSummary = {
  id: ROW.sessionId, displayTitle: ROW.displayTitle, running: false, blank: false, updatedAt: 1, retainedBy: {},
}
const sessions: SessionListState = {
  ids: [one.id], byId: { [one.id]: one }, phase: 'ready', projectionsBySession: {},
}
// The Workspace snapshot lists no pins or archives: an action's membership
// arrives through its injected Set hooks, never through this seat.
const workspaces: WorkspaceSnapshot = {
  items: [{
    workspaceId: 'alpha' as WorkspaceId, path: '/projects/alpha', title: 'alpha', sessionIds: [one.id],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
  archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
}
const noStatus: SessionStatusSnapshot = new Map()
// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** The global standard seat every root-scope entry receives. */
const standard: GlobalStandardProps = {
  useSessions: hook(sessions),
  useSessionStatus: hook(noStatus),
  useSessionRetainInfo: () => undefined,
  usePanelInfo,
  useResource,
  useWorkspaces: hook(workspaces),
}

type MenuRowProps = PropsRuntime<'sidebar.workspaces.session.menu.item'> & PropsLocale<'workspace'>
type OverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<'workspace'>

/** Owner share, standard seat, locale seat, and the bound open-state hook of one menu row. */
function menuRow(menu: MenuOpenState): MenuRowProps {
  return { ...ROW, useMenuOpenState: () => menu, useShortcuts: hook([]), t, ...standard }
}

/** Standard and locale seats of a `shell.overlay` entry (no owner share). */
const overlay: OverlayProps = { t, ...standard }

/** An open menu whose setter records the entries' dismissal. */
function openMenu() {
  const setMenuOpen = vi.fn()
  const state: MenuOpenState = [true, setMenuOpen]
  return { state, setMenuOpen }
}

/** Position of a mock's `nth` call in the global call sequence (a call that never happened sorts last). */
function callOrder(fn: { mock: { invocationCallOrder: readonly number[] } }, nth = 0): number {
  return fn.mock.invocationCallOrder[nth] ?? Number.POSITIVE_INFINITY
}

const workspaceView = (id: string, title: string, sessionIds: string[] = []) => ({
  workspaceId: id as WorkspaceId, path: `/projects/${id}`, title, sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('switch workspace action', () => {
  it('menu row closes the menu, then asks for the target-Workspace dialog with the row title', () => {
    const { state, setMenuOpen } = openMenu()
    const requestWorkspaceSwitch = vi.fn()
    render(<SwitchWorkspaceMenuItem {...menuRow(state)} requestWorkspaceSwitch={requestWorkspaceSwitch} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '切换工作区' }))
    expect(requestWorkspaceSwitch).toHaveBeenCalledWith(sid('one'), 'Session title')
    expect(setMenuOpen).toHaveBeenCalledWith(false)
    expect(callOrder(setMenuOpen)).toBeLessThan(callOrder(requestWorkspaceSwitch))
  })
})

describe('WorkspaceSwitchDialog', () => {
  /** The dialog over a test-owned request source and a Workspace list; settling clears the request the way apply does. */
  function switchDialog(
    switchWorkspace: WorkspaceSwitchDialogInjected['switchWorkspace'],
    items = [workspaceView('alpha', 'alpha', ['one']), workspaceView('beta', 'Beta project'), workspaceView('gamma', 'Gamma')],
    translate = t,
  ) {
    const request = createSnapshotStore<WorkspaceSwitchRequest | null>(null)
    const settleWorkspaceSwitch = vi.fn(() => { request.set(null) })
    render(
      <WorkspaceSwitchDialog
        {...overlay}
        t={translate}
        useWorkspaces={hook({ ...workspaces, items })}
        useSwitchRequest={bindSnapshotSelector(request)}
        settleWorkspaceSwitch={settleWorkspaceSwitch}
        switchWorkspace={switchWorkspace}
      />,
    )
    const ask = (): void => { act(() => { request.set({ sessionId: sid('one'), displayTitle: 'Moving session' }) }) }
    return { settleWorkspaceSwitch, ask }
  }
  const outcome = (value: WorkspaceSwitchOutcome) => vi.fn<WorkspaceSwitchDialogInjected['switchWorkspace']>(async () => value)

  it('renders nothing until a request is raised', () => {
    switchDialog(outcome({ status: 'switched' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers every Workspace except the one that already holds the Session, and switches to the chosen one', async () => {
    const pending = Promise.withResolvers<WorkspaceSwitchOutcome>()
    const switchWorkspace = vi.fn<WorkspaceSwitchDialogInjected['switchWorkspace']>(() => pending.promise)
    const { settleWorkspaceSwitch, ask } = switchDialog(switchWorkspace)
    ask()
    const dialog = screen.getByRole('dialog', { name: '切换工作区？' })
    expect(dialog.textContent).toContain('“Moving session”将改为在所选工作区中工作')
    const choices = [...screen.getByRole('list', { name: '目标工作区' }).querySelectorAll('button')]
    expect(choices.map(button => button.textContent)).toEqual(['Beta project', 'Gamma'])
    expect(choices[0]!.title).toBe('/projects/beta')

    fireEvent.click(choices[0]!)
    expect(switchWorkspace).toHaveBeenCalledWith(sid('one'), 'beta')
    expect(screen.getByRole('status').textContent).toBe('正在切换工作区…')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(settleWorkspaceSwitch).not.toHaveBeenCalled()
    await act(async () => { pending.resolve({ status: 'switched' }) })
    expect(settleWorkspaceSwitch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the dialog open with the failure shown, and Cancel settles', async () => {
    const { settleWorkspaceSwitch, ask } = switchDialog(outcome({ status: 'failed', message: 'fork refused' }))
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))
    expect((await screen.findByRole('alert')).textContent).toBe('fork refused')
    expect(settleWorkspaceSwitch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(settleWorkspaceSwitch).toHaveBeenCalledOnce()
  })

  it('explains a Session with running work and a Session another FORGE owns, and keeps the dialog open', async () => {
    const switchWorkspace = vi.fn<WorkspaceSwitchDialogInjected['switchWorkspace']>()
      .mockResolvedValueOnce({ status: 'busy' })
      .mockResolvedValueOnce({ status: 'in-use' })
    const { settleWorkspaceSwitch, ask } = switchDialog(switchWorkspace)
    ask()
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))
    expect((await screen.findByRole('alert')).textContent).toBe('此会话仍有正在进行的工作。请先停止它，再切换工作区。')
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('正被其他正在运行的 FORGE')
    expect(settleWorkspaceSwitch).not.toHaveBeenCalled()
  })

  it('says so when there is no other Workspace to move to', () => {
    const { ask } = switchDialog(outcome({ status: 'switched' }), [workspaceView('alpha', 'alpha', ['one'])])
    ask()
    expect(screen.getByRole('dialog').textContent).toContain('没有其他工作区')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('speaks English when the locale seat is English', () => {
    const { ask } = switchDialog(outcome({ status: 'switched' }), undefined, tEn)
    ask()
    expect(screen.getByRole('dialog', { name: 'Switch workspace?' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Target workspaces' })).toBeTruthy()
  })
})
