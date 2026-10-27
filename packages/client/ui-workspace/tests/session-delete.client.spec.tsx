// @vitest-environment jsdom
/**
 * The delete action rendered directly with hand-built props: the menu row
 * that raises the confirmation request and the `shell.overlay` dialog that
 * answers it, including the stop-and-delete second step.
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
  MenuOpenState, SessionDeleteDialogInjected, SessionDeleteOutcome, SessionDeleteRequest,
} from '../src/client/contract/slots.ts'
import { DeleteSessionMenuItem, SessionDeleteDialog } from '../src/client/session-actions/DeleteSession.tsx'
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

const BUSY = [{ kind: 'turn' as const }, { kind: 'job' as const, items: [{ id: 'bash-1', label: 'pnpm run build' }] }]

describe('delete action', () => {
  it('menu row is destructive, closes the menu, then asks for the confirmation with the row title', () => {
    const { state, setMenuOpen } = openMenu()
    const requestSessionDelete = vi.fn()
    render(<DeleteSessionMenuItem {...menuRow(state)} requestSessionDelete={requestSessionDelete} />)
    const row = screen.getByRole('menuitem', { name: '删除会话' })
    expect(row.className).toMatch(/danger/)
    fireEvent.click(row)
    expect(requestSessionDelete).toHaveBeenCalledWith(sid('one'), 'Session title')
    expect(setMenuOpen).toHaveBeenCalledWith(false)
    expect(callOrder(setMenuOpen)).toBeLessThan(callOrder(requestSessionDelete))
  })
})

describe('SessionDeleteDialog', () => {
  /** The dialog over a test-owned request source; settling clears the request the way apply does. */
  function deleteDialog(deleteSession: SessionDeleteDialogInjected['deleteSession'], translate = t) {
    const request = createSnapshotStore<SessionDeleteRequest | null>(null)
    const settleSessionDelete = vi.fn(() => { request.set(null) })
    render(
      <SessionDeleteDialog
        {...overlay}
        t={translate}
        useDeleteRequest={bindSnapshotSelector(request)}
        settleSessionDelete={settleSessionDelete}
        deleteSession={deleteSession}
      />,
    )
    const ask = (sessionId = 'one'): void => {
      act(() => { request.set({ sessionId: sid(sessionId), displayTitle: 'Doomed session' }) })
    }
    return { settleSessionDelete, ask }
  }
  const outcome = (value: SessionDeleteOutcome) => vi.fn<SessionDeleteDialogInjected['deleteSession']>(async () => value)

  it('renders nothing until a deletion is requested', () => {
    deleteDialog(outcome({ status: 'deleted' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the session, says the deletion is permanent, and deletes on confirm', async () => {
    const pending = Promise.withResolvers<SessionDeleteOutcome>()
    const deleteSession = vi.fn<SessionDeleteDialogInjected['deleteSession']>(() => pending.promise)
    const { settleSessionDelete, ask } = deleteDialog(deleteSession)
    ask()
    const dialog = screen.getByRole('dialog', { name: '永久删除此会话？' })
    expect(dialog.textContent).toContain('“Doomed session”及其全部对话记录将被永久删除，此操作无法撤销。')
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    expect(deleteSession).toHaveBeenCalledWith(sid('one'), { stopActivity: false })
    // While the Host call is pending, closing is blocked and the status shows.
    expect(screen.getByRole('status').textContent).toBe('正在删除会话…')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(settleSessionDelete).not.toHaveBeenCalled()
    await act(async () => { pending.resolve({ status: 'deleted' }) })
    expect(settleSessionDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores Escape while the Host call is pending', async () => {
    const pending = Promise.withResolvers<SessionDeleteOutcome>()
    const { settleSessionDelete, ask } = deleteDialog(vi.fn<SessionDeleteDialogInjected['deleteSession']>(() => pending.promise))
    ask()
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(settleSessionDelete).not.toHaveBeenCalled()
    await act(async () => { pending.resolve({ status: 'failed', message: 'nope' }) })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(settleSessionDelete).toHaveBeenCalledOnce()
  })

  it('Cancel settles without deleting', () => {
    const deleteSession = outcome({ status: 'deleted' })
    const { settleSessionDelete, ask } = deleteDialog(deleteSession)
    ask()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(settleSessionDelete).toHaveBeenCalledOnce()
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('lists the running work the Host reported, then stops and deletes on the second confirm', async () => {
    const deleteSession = vi.fn<SessionDeleteDialogInjected['deleteSession']>()
      .mockResolvedValueOnce({ status: 'active', activity: BUSY })
      .mockResolvedValueOnce({ status: 'deleted' })
    const { settleSessionDelete, ask } = deleteDialog(deleteSession)
    ask()
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    const list = await screen.findByRole('list', { name: '将被停止的工作' })
    expect([...list.querySelectorAll('li')].map(li => li.textContent)).toEqual(['进行中的回合', '1 个后台任务：pnpm run build'])
    expect(screen.getByRole('dialog').textContent).toContain('删除前将先停止这些工作')
    expect(settleSessionDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '停止并删除' }))
    await act(async () => {})
    expect(deleteSession).toHaveBeenLastCalledWith(sid('one'), { stopActivity: true })
    expect(settleSessionDelete).toHaveBeenCalledOnce()
  })

  it('explains a session another FORGE owns and keeps the dialog open', async () => {
    const { settleSessionDelete, ask } = deleteDialog(outcome({ status: 'in-use' }))
    ask()
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    expect((await screen.findByRole('alert')).textContent).toContain('正被其他正在运行的 FORGE')
    expect(settleSessionDelete).not.toHaveBeenCalled()
  })

  it('shows any other failure verbatim, and Escape closes once nothing is pending', async () => {
    const { settleSessionDelete, ask } = deleteDialog(outcome({ status: 'failed', message: 'disk on fire' }))
    ask()
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    expect((await screen.findByRole('alert')).textContent).toBe('disk on fire')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(settleSessionDelete).toHaveBeenCalledOnce()
  })

  it('speaks English when the locale seat is English', () => {
    const { ask } = deleteDialog(outcome({ status: 'deleted' }), tEn)
    ask()
    expect(screen.getByRole('dialog', { name: 'Delete this session permanently?' }).textContent)
      .toContain('“Doomed session” and its entire conversation history will be deleted permanently. This cannot be undone.')
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeTruthy()
  })
})
