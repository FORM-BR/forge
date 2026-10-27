import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  SessionListState, SessionReference, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  type ArchiveSessionInjected, type SwitchWorkspaceInjected, type WorkspaceSwitchDialogInjected, type DeleteSessionInjected,
  type ForkSessionInjected, type SessionDeleteDialogInjected,
  type RetitleSessionInjected, menuOpenStateFactory, type PinSessionInjected,
  workspaceMenuOpenStateFactory,
  type RenameSessionInjected, type RowToastInjected, type SessionArchiveConfirmInjected, type SessionRenameDialogInjected,
  type WorkspaceStatusInjected, type WorkspaceSwitcherInjected, type WorkspaceViewStoreHandle,
} from '../src/client/contract/slots.ts'
import { WorkspaceBrowser } from '../src/client/rows/WorkspaceBrowser.tsx'
import { ArchiveSessionMenuItem, ArchiveSessionRowButton, SessionArchiveConfirmDialog } from '../src/client/session-actions/ArchiveSession.tsx'
import { SwitchWorkspaceMenuItem, WorkspaceSwitchDialog } from '../src/client/session-actions/SwitchWorkspace.tsx'
import { DeleteSessionMenuItem, SessionDeleteDialog } from '../src/client/session-actions/DeleteSession.tsx'
import { ForkSessionMenuItem } from '../src/client/session-actions/ForkSession.tsx'
import { PinSessionMenuItem, PinSessionRowButton } from '../src/client/session-actions/PinSession.tsx'
import { RenameSessionMenuItem, SessionRenameDialog } from '../src/client/session-actions/RenameSession.tsx'
import { RetitleSessionMenuItem } from '../src/client/session-actions/RetitleSession.tsx'
import { RowActionToast } from '../src/client/session-actions/RowActionToast.tsx'
import { HeroGitChip } from '../src/client/status/HeroGitChip.tsx'
import { WorkspaceSwitcher } from '../src/client/status/WorkspaceSwitcher.tsx'
import { PinWorkspaceMenuItem } from '../src/client/session-actions/PinWorkspace.tsx'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { FLAT_SESSION_ORDER_KEY } from '../src/client/stores.ts'
import { UNGROUPED_KEY } from '../src/client/tree.ts'
import { apply as hostApply } from '../src/index.ts'

const sid = (id: string) => id as SessionId
/** A Host refusal as the Workspace Controller facade throws it for archive, delete, and switch. */
const failure = (code: string, details: object) => Object.assign(new Error(`workspace session delete failed: ${code}`), {
  name: 'WorkspaceArchiveError',
  rpcError: new RemoteError(code as 'workspace/session-active', 'refused', details as never),
})
const summary = (id: string, updatedAt: number): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, retainedBy: {},
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  phase: 'ready',
  projectionsBySession: {},
})
const workspace = (id: string, sessionIds: readonly string[]): WorkspaceView => ({
  workspaceId: id as WorkspaceId, path: `/projects/${id}`, title: id,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (
  items: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[] = [],
  pinnedSessionIds: readonly SessionId[] = [],
): WorkspaceSnapshot => ({
  items, archivedSessionIds, pinnedSessionIds, state: 'idle', phase: 'ready', error: null,
})

async function bench() {
  const ctx = new Context()
  ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore([]) })
  ctx.provide('uiConversation', {})
  await ctx.plugin(SlotRegistry).await()
  const create = vi.fn(async (input: { name: string } | { path: string }) => ({
    workspaceId: 'ws-new' as never,
    path: 'name' in input ? `/projects/${input.name}` : input.path,
    title: 'new', sessionIds: [], createdAt: '0', updatedAt: '0',
  }))
  const rename = vi.fn(async () => ({}))
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel, beginNavigation: () => new AbortController().signal })
  const search = vi.fn(async () => ({
    ok: true as const,
    value: { items: [{ sessionId: 'session' as never, snippet: 'match' }], hasMore: false },
  }))
  const renameSession = vi.fn(async (title: string) => ({ ok: true, value: { title, seq: 1 } }))
  const binding = vi.fn((_id: string) => ({ session: { rename: renameSession } }))
  const retain = vi.fn((target: string) => {
    const resolved = binding(target)
    const release = vi.fn()
    return {
      sessionId: target,
      binding: resolved,
      ready: Promise.resolve(resolved),
      release,
      [Symbol.dispose]: release,
    } as unknown as SessionReference
  })
  const using = vi.fn(async (
    target: string,
    _options: unknown,
    operation: (reference: SessionReference) => unknown,
  ) => await operation(retain(target)))
  const fork = vi.fn(async () => 'forked' as never)
  const refreshTitle = vi.fn(async (_id: string, _opts?: unknown): Promise<{ status: string; title?: string; seq?: number }> => ({ status: 'refreshed', title: 'x', seq: 1 }))
  const pinSession = vi.fn(async () => undefined)
  const unpinSession = vi.fn(async () => undefined)
  // The Host snapshots the injected hooks derive from and a pin's order write
  // reads at completion; a test replaces them whole, so an unchanged snapshot
  // keeps its identity between reads.
  let workspaceSnapshot = workspaceState([])
  let sessionSnapshot = sessionState([])
  const subscribe = () => () => {}
  const workspacesSubscribe = vi.fn(subscribe)
  const initializeDefault = vi.fn(async (): Promise<WorkspaceView | undefined> => undefined)
  const gitInfo = vi.fn(async (path: string) => ({
    path, git: { repoName: 'repo', root: path, branch: 'main', detached: false },
  }))
  ctx.provide('workspaces', {
    gitInfo,
    list: { getSnapshot: () => workspaceSnapshot, subscribe: workspacesSubscribe },
    create,
    initializeDefault,
    rename,
    delete: vi.fn(async () => undefined),
    insertBefore: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    unarchiveSession: vi.fn(async () => undefined),
    pinSession,
    unpinSession,
    insertSessionBefore: vi.fn(async () => ({})),
  } as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => sessionSnapshot, subscribe },
    create: vi.fn(async () => 'created' as never),
    retain,
    using,
    search,
    searchResultLimit: 20,
    binding,
    subagentAddress: vi.fn(() => undefined),
    refreshProjections: vi.fn(() => Promise.resolve()),
    fork,
    refreshTitle,
  } as never)
  const pickDirectory = vi.fn(() => Promise.resolve({ ok: true as const, value: '/projects/picked' }))
  const directoryPicker = { pick: pickDirectory }
  Object.assign(new TestRemote(ctx), { directoryPicker })
  ctx.provide('remote.directoryPicker', directoryPicker as never)
  const locale = new LocaleRuntime(ctx)
  // These specs assert the shipped Chinese copy. There is no jsdom `window`
  // in this lane, so browser-language detection never runs and the locale
  // comes from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, create, rename,
    retain, using, selectPanel, search, renameSession, binding, fork, refreshTitle, pickDirectory, pinSession, unpinSession,
    workspacesSubscribe, initializeDefault, gitInfo,
    setWorkspaces: (snapshot: WorkspaceSnapshot): void => { workspaceSnapshot = snapshot },
    setSessions: (snapshot: SessionListState): void => { sessionSnapshot = snapshot },
  }
}

type HoleName = 'sidebar.workspaces' | 'conversation.hero.workspace' | 'conversation.empty.workspace' | 'shell.overlay'

const MENU_ITEM = 'sidebar.workspaces.session.menu.item'
const ROW_ACTION = 'sidebar.workspaces.session.row.action'
type RowListName = typeof MENU_ITEM | typeof ROW_ACTION | 'shell.overlay'

/** Declare any subset of the holes with a single root registration ('root' is a single slot); the overlay is a list. */
function declare(slots: SlotRegistry, ...names: HoleName[]): () => void {
  const children = Object.fromEntries(names.map(name => [
    name, { kind: name === 'shell.overlay' ? 'list' : 'single', scope: 'root' },
  ]))
  return slots.register({ name: 'root', children } as never, () => null)
}

/** The one entry registered under `id` in a list. */
function entry(slots: SlotRegistry, key: RowListName, id: string): StoredEntry {
  const found = slots.entries(key).find(candidate => candidate.options.id === id)
  if (found === undefined) throw new Error(`no ${key} entry ${id}`)
  return found
}

/** An entry's injected face; the shipped factories ignore the positional store actions. */
function faceOf(registration: StoredEntry): object {
  if (registration.inject === undefined) throw new Error(`entry ${String(registration.options.id)} declares no inject face`)
  return registration.inject()
}

/** The viewing-store instance the browser's declared handle hands the renderer. */
function viewInstance(slots: SlotRegistry) {
  const browser = slots.entries('sidebar.workspaces')[0]!
  if (browser.store === undefined) throw new Error('the browser entry declares no viewing store')
  return (browser.store as WorkspaceViewStoreHandle).create()
}

/** Let the injected callbacks' Host-call chains settle: one macrotask drains every pending microtask. */
const settled = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('ui-workspace apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it drives', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts',
    ])
  })

  it('reports a default Workspace creation failure through the shared notice overlay', async () => {
    const b = await bench()
    onTestFinished(() => b.ctx.fiber.dispose())
    b.initializeDefault.mockRejectedValueOnce(new Error('denied'))
    declare(b.slots, 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    await vi.waitFor(() => {
      expect(face.hooks.toast.getSnapshot()).toMatchObject({ kind: 'defaultWorkspaceFailed' })
    })
    face.dismissToast()
    expect(face.hooks.toast.getSnapshot()).toBeNull()
  })

  it('registers browser and pickers for declarations arriving before or after apply', async () => {
    const before = await bench()
    declare(before.slots, 'sidebar.workspaces')
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.workspaces')[0]!.component).toBe(WorkspaceBrowser)
    // Copy rides the standard locale seat: the entry declares the namespace
    // and apply registered both dictionaries.
    expect(before.slots.entries('sidebar.workspaces')[0]!.locale).toBe('workspace')
    expect(before.locale.bind('workspace')('session.new')).toBe('新会话')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    declare(after.slots, 'sidebar.workspaces', 'conversation.hero.workspace', 'conversation.empty.workspace', 'shell.overlay')
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.workspace')[0]!.component).toBe(WorkspacePicker)
    // The row actions follow the browser's own declaration, whenever it lands.
    expect(after.slots.entries(MENU_ITEM)).toHaveLength(7)
    expect(after.slots.entries(ROW_ACTION)).toHaveLength(2)
    expect(after.slots.entries('shell.overlay')).toHaveLength(5)
  })

  it('declares the Workspace menu and badge seats, binding the menu open state into the rows', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.spec('sidebar.workspaces.workspace.menu.item')).toEqual({
      kind: 'list', scope: 'root', inject: { hooks: { menuOpenState: workspaceMenuOpenStateFactory } },
    })
    expect(b.slots.spec('sidebar.workspaces.workspace.badge')).toEqual({ kind: 'list', scope: 'root' })
    // The shipped package adds only the pin row to the menu and nothing to the badge seat: plugins fill the rest.
    expect(b.slots.entries('sidebar.workspaces.workspace.menu.item').map(row => row.options.id)).toEqual(['pin'])
    expect(b.slots.entries('sidebar.workspaces.workspace.badge')).toHaveLength(0)
    const openState = [true, () => {}] as const
    const factory = workspaceMenuOpenStateFactory as unknown as (standard: object, state: typeof openState) => () => typeof openState
    expect(factory({}, openState)()).toBe(openState)
  })

  it('registers the Workspace switcher beside the Session title and wires its Host callbacks', async () => {
    const b = await bench()
    onTestFinished(() => b.ctx.fiber.dispose())
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The header actions list is declared by ui-conversation, whenever that apply lands.
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    b.slots.register({
      name: 'root', children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    const actions = b.slots.entries('conversation.session.header.actions')
    expect(actions).toHaveLength(1)
    expect(actions[0]!.component).toBe(WorkspaceSwitcher)
    expect(actions[0]!.options).toMatchObject({ id: 'workspace', order: -5 })
    expect(actions[0]!.locale).toBe('workspace')
    expect(actions[0]!.store).toBeUndefined()
    expect(b.slots.spec('conversation.session.header.workspace.directoryFlow')).toMatchObject({ kind: 'single' })

    const face = faceOf(actions[0]!) as WorkspaceSwitcherInjected
    const signal = new AbortController().signal
    await expect(face.gitInfo('/projects/alpha', signal)).resolves.toMatchObject({ git: { repoName: 'repo' } })
    expect(b.gitInfo).toHaveBeenCalledWith('/projects/alpha', signal)
    await face.createWorkspace({ path: '/tmp/opened' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/opened' })

    // The pin set rides the hooks compartment and follows the shared viewing store.
    expect(face.hooks.pinnedWorkspaces.getSnapshot()).toEqual([])
    face.toggleWorkspacePin('alpha' as WorkspaceId)
    expect(face.hooks.pinnedWorkspaces.getSnapshot()).toEqual(['alpha'])
    face.toggleWorkspacePin('alpha' as WorkspaceId)
    expect(face.hooks.pinnedWorkspaces.getSnapshot()).toEqual([])

    // The switcher's own directory-flow hole reports occupancy like the other two surfaces.
    expect(face.hooks.directoryFlow.getSnapshot()).toBe(false)
    const dispose = b.slots.register({ name: 'conversation.session.header.workspace.directoryFlow' } as never, () => null)
    expect(face.hooks.directoryFlow.getSnapshot()).toBe(true)
    dispose()
    expect(face.hooks.directoryFlow.getSnapshot()).toBe(false)

    const switchWorkspace = vi.spyOn(b.ctx.uiWorkspace, 'switchWorkspace').mockResolvedValue(undefined)
    await expect(face.switchWorkspace(sid('source'), 'other' as WorkspaceId)).resolves.toEqual({ status: 'switched' })
    expect(switchWorkspace).toHaveBeenCalledWith('source', 'other')
  })

  it('registers the pin row into the Workspace header menu with the shared viewing store', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const rows = b.slots.entries('sidebar.workspaces.workspace.menu.item')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.component).toBe(PinWorkspaceMenuItem)
    expect(rows[0]!.options).toMatchObject({ id: 'pin', order: 50 })
    expect(rows[0]!.locale).toBe('workspace')
    expect(rows[0]!.store).toBe(b.slots.entries('sidebar.workspaces')[0]!.store)
  })

  it('registers the hero git chip into the hero status seat and wires its git lookup', async () => {
    const b = await bench()
    onTestFinished(() => b.ctx.fiber.dispose())
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('conversation.hero.workspace.status')).toHaveLength(0)
    b.slots.register({
      name: 'root', children: { 'conversation.hero.workspace.status': { kind: 'single', scope: 'root' } },
    } as never, () => null)
    await Promise.resolve()
    const seat = b.slots.entries('conversation.hero.workspace.status')
    expect(seat).toHaveLength(1)
    expect(seat[0]!.component).toBe(HeroGitChip)
    expect(seat[0]!.locale).toBe('workspace')
    const face = faceOf(seat[0]!) as WorkspaceStatusInjected
    await face.gitInfo('/projects/alpha', new AbortController().signal)
    expect(b.gitInfo).toHaveBeenCalledWith('/projects/alpha', expect.any(AbortSignal))
  })

  it('declares the two Session row lists and registers the shipped actions and overlay surfaces into them', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The menu list binds the row's open state into every entry's hook; the
    // hover-button list carries no common face.
    expect(b.slots.spec(MENU_ITEM)).toEqual({
      kind: 'list', scope: 'root', inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: b.ctx.shortcuts.catalog } },
    })
    expect(b.slots.spec(ROW_ACTION)).toEqual({ kind: 'list', scope: 'root' })

    const rows = (key: RowListName) => b.slots.entries(key)
      .map(registration => [registration.options.id, registration.options.order, registration.component, registration.locale])
    expect(rows(MENU_ITEM)).toEqual([
      ['pin', 100, PinSessionMenuItem, 'workspace'],
      ['rename', 200, RenameSessionMenuItem, 'workspace'],
      ['retitle', 250, RetitleSessionMenuItem, 'workspace'],
      ['fork', 300, ForkSessionMenuItem, 'workspace'],
      ['switch-workspace', 350, SwitchWorkspaceMenuItem, 'workspace'],
      ['archive', 400, ArchiveSessionMenuItem, 'workspace'],
      ['delete', 1000, DeleteSessionMenuItem, 'workspace'],
    ])
    expect(rows(ROW_ACTION)).toEqual([
      ['archive', 100, ArchiveSessionRowButton, 'workspace'],
      ['pin', 200, PinSessionRowButton, 'workspace'],
    ])
    expect(rows('shell.overlay')).toEqual([
      ['workspace.session-rename', undefined, SessionRenameDialog, 'workspace'],
      ['workspace.session-archive', undefined, SessionArchiveConfirmDialog, 'workspace'],
      ['workspace.workspace-switch', undefined, WorkspaceSwitchDialog, 'workspace'],
      ['workspace.session-delete', undefined, SessionDeleteDialog, 'workspace'],
      ['workspace.row-toast', undefined, RowActionToast, 'workspace'],
    ])
    // The browser and the row toast declare the same viewing-store handle,
    // which hands out one instance: the browser's injected callbacks write
    // view state through it and the toast reads the archived filter from it.
    // The row actions and the other overlay surfaces declare none.
    const browser = b.slots.entries('sidebar.workspaces')[0]!
    expect(browser.store).toBeDefined()
    expect(viewInstance(b.slots)).toBe(viewInstance(b.slots))
    const rowToastEntry = entry(b.slots, 'shell.overlay', 'workspace.row-toast')
    expect(rowToastEntry.store).toBe(browser.store)
    for (const registration of [...b.slots.entries(MENU_ITEM), ...b.slots.entries(ROW_ACTION), ...b.slots.entries('shell.overlay')]) {
      if (registration === rowToastEntry) continue
      expect(registration.store).toBeUndefined()
    }
    // Each share raises its own notices inside its callbacks.
    for (const id of ['pin', 'archive']) {
      expect(faceOf(entry(b.slots, MENU_ITEM, id))).not.toHaveProperty('notify')
      expect(faceOf(entry(b.slots, ROW_ACTION, id))).not.toHaveProperty('notify')
    }
  })

  it('derives the pinned and archived Sets from the Workspace snapshot, rebuilt only when it changes', async () => {
    const b = await bench()
    b.setWorkspaces(workspaceState([workspace('alpha', ['one', 'two'])], [sid('two')], [sid('one')]))
    declare(b.slots, 'sidebar.workspaces')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const pin = faceOf(entry(b.slots, MENU_ITEM, 'pin')) as PinSessionInjected
    const pinButton = faceOf(entry(b.slots, ROW_ACTION, 'pin')) as PinSessionInjected
    const archive = faceOf(entry(b.slots, ROW_ACTION, 'archive')) as ArchiveSessionInjected
    const pinned = pin.hooks.pinned.getSnapshot()
    const archived = pin.hooks.archived.getSnapshot()
    expect(pinned).toEqual(new Set(['one']))
    expect(archived).toEqual(new Set(['two']))
    // One source per set, shared by every entry and held while the snapshot stands.
    expect(pin.hooks.pinned.getSnapshot()).toBe(pinned)
    expect(pinButton.hooks.pinned.getSnapshot()).toBe(pinned)
    expect(archive.hooks.archived.getSnapshot()).toBe(archived)
    // Subscriptions ride the Workspace Controller's list source.
    const listener = vi.fn()
    const unsubscribe = pin.hooks.pinned.subscribe(listener)
    expect(b.workspacesSubscribe).toHaveBeenCalledWith(listener)
    unsubscribe()

    b.setWorkspaces(workspaceState([workspace('alpha', ['one', 'two'])], [], [sid('one'), sid('two')]))
    expect(pin.hooks.pinned.getSnapshot()).toEqual(new Set(['one', 'two']))
    expect(pin.hooks.pinned.getSnapshot()).not.toBe(pinned)
    expect(archive.hooks.archived.getSnapshot()).toEqual(new Set())
  })

  it('regenerates one session title without skipPinned, with start, success, empty, and failure notices', async () => {
    const b = await bench()
    b.setWorkspaces(workspaceState([workspace('alpha', ['one'])]))
    b.setSessions(sessionState([summary('one', 1)]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const retitle = faceOf(entry(b.slots, MENU_ITEM, 'retitle')) as RetitleSessionInjected
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onTestFinished(() => { warn.mockRestore() })

    b.refreshTitle.mockResolvedValueOnce({ status: 'refreshed', title: 'Novo titulo', seq: 2 })
    retitle.retitleSession(sid('one'))
    expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleSessionStarted' })
    await vi.waitFor(() => {
      expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleSessionDone', title: 'Novo titulo' })
    })
    // The explicit action replaces a hand-set title: no pin policy is sent.
    expect(b.refreshTitle).toHaveBeenLastCalledWith('one')

    b.refreshTitle.mockResolvedValueOnce({ status: 'no-input' })
    retitle.retitleSession(sid('one'))
    await vi.waitFor(() => {
      expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleSessionDone', title: '' })
    })

    b.refreshTitle.mockRejectedValueOnce(new Error('model offline'))
    retitle.retitleSession(sid('one'))
    await vi.waitFor(() => {
      expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleSessionFailed', reason: 'model offline' })
    })
  })

  it('regenerates the titles of a workspace one by one, skipping archived and blank rows, and reports the outcome', async () => {
    const b = await bench()
    b.setWorkspaces(workspaceState([workspace('alpha', ['one', 'two', 'three', 'four', 'blank'])], [sid('four')]))
    b.setSessions(sessionState([
      summary('one', 5), summary('two', 4), summary('three', 3), summary('four', 2),
      { ...summary('blank', 1), blank: true },
    ]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    b.refreshTitle.mockResolvedValueOnce({ status: 'refreshed', title: 'a', seq: 1 })
    b.refreshTitle.mockResolvedValueOnce({ status: 'skipped-pinned' })
    b.refreshTitle.mockRejectedValueOnce(new Error('model offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onTestFinished(() => { warn.mockRestore() })

    browser.retitleWorkspaceSessions('alpha' as never)
    expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleStarted', total: 3 })
    // Single-flight: a second request while one runs is ignored.
    browser.retitleWorkspaceSessions('alpha' as never)
    await vi.waitFor(() => {
      expect(toast.hooks.toast.getSnapshot()).toMatchObject({ kind: 'retitleDone', refreshed: 1, skipped: 1, failed: 1, reason: 'model offline' })
    })
    expect(b.refreshTitle.mock.calls).toEqual([
      ['one', { skipPinned: true }], ['two', { skipPinned: true }], ['three', { skipPinned: true }],
    ])
    // The flag clears after a run, and an unknown Workspace is a no-op.
    browser.retitleWorkspaceSessions('missing' as never)
    expect(b.refreshTitle).toHaveBeenCalledTimes(3)
    browser.retitleWorkspaceSessions('alpha' as never)
    await vi.waitFor(() => { expect(b.refreshTitle).toHaveBeenCalledTimes(6) })
  })

  it('pins through the navigation service, which fronts the Session in its group and the flat list of the browser view', async () => {
    const b = await bench()
    b.setWorkspaces(workspaceState([workspace('alpha', ['one', 'two', 'three'])]))
    b.setSessions(sessionState([summary('one', 3), summary('two', 2), summary('three', 1)]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const view = viewInstance(b.slots)
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    expect(view.getSnapshot().sessionOrderByAccount).toEqual({})

    const pin = faceOf(entry(b.slots, MENU_ITEM, 'pin')) as PinSessionInjected
    pin.pinSession(sid('three'))
    expect(b.pinSession).toHaveBeenCalledWith('three')
    await vi.waitFor(() => {
      expect(view.getSnapshot().sessionOrderByAccount).toEqual({
        alpha: ['three', 'one', 'two'],
        [UNGROUPED_KEY]: [],
        [FLAT_SESSION_ORDER_KEY]: ['three', 'one', 'two'],
      })
    })
    // The saved positions lead without leaving Last updated, and a successful pin raises no notice.
    expect(view.getSnapshot().orderBy).toBe('updated')
    expect(toast.hooks.toast.getSnapshot()).toBeNull()

    // The hover button's face is the same behavior.
    const pinButton = faceOf(entry(b.slots, ROW_ACTION, 'pin')) as PinSessionInjected
    pinButton.pinSession(sid('one'))
    expect(b.pinSession).toHaveBeenLastCalledWith('one')
    await vi.waitFor(() => {
      expect(view.getSnapshot().sessionOrderByAccount.alpha).toEqual(['one', 'three', 'two'])
    })

    // Unpin leaves the saved orders as they are.
    const before = view.getSnapshot().sessionOrderByAccount
    pin.unpinSession(sid('one'))
    expect(b.unpinSession).toHaveBeenCalledWith('one')
    await settled()
    expect(view.getSnapshot().sessionOrderByAccount).toBe(before)
    expect(toast.hooks.toast.getSnapshot()).toBeNull()
  })

  it('raises the pin and unpin failure notices and writes no order', async () => {
    const b = await bench()
    b.setWorkspaces(workspaceState([workspace('alpha', ['one'])]))
    b.setSessions(sessionState([summary('one', 1)]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const view = viewInstance(b.slots)
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    const pin = faceOf(entry(b.slots, ROW_ACTION, 'pin')) as PinSessionInjected

    b.pinSession.mockRejectedValueOnce(new Error('pin wire down'))
    pin.pinSession(sid('one'))
    await vi.waitFor(() => { expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'pinFailed', seq: 1 }) })
    b.unpinSession.mockRejectedValueOnce(new Error('unpin wire down'))
    pin.unpinSession(sid('one'))
    await vi.waitFor(() => { expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'unpinFailed', seq: 2 }) })
    expect(view.getSnapshot().sessionOrderByAccount).toEqual({})
  })

  it('archives through the navigation service and raises the archived notice; Host rejections are console diagnostics', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const archiveSession = vi.spyOn(b.ctx.uiWorkspace, 'archiveSession').mockResolvedValue(undefined)
    const unarchiveSession = vi.spyOn(b.ctx.uiWorkspace, 'unarchiveSession').mockResolvedValue(undefined)
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    const archive = faceOf(entry(b.slots, ROW_ACTION, 'archive')) as ArchiveSessionInjected

    archive.archiveSession(sid('one'))
    expect(archiveSession).toHaveBeenCalledWith('one')
    await vi.waitFor(() => {
      expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'archived', sessionId: 'one', seq: 1 })
    })
    // The menu row's face is the same behavior; a restore raises no notice.
    const archiveRow = faceOf(entry(b.slots, MENU_ITEM, 'archive')) as ArchiveSessionInjected
    archiveRow.unarchiveSession(sid('one'))
    expect(unarchiveSession).toHaveBeenCalledWith('one')
    await settled()
    expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'archived', sessionId: 'one', seq: 1 })

    const archiveRejection = new Error('archive exploded')
    const unarchiveRejection = new Error('unarchive exploded')
    archiveSession.mockRejectedValueOnce(archiveRejection)
    unarchiveSession.mockRejectedValueOnce(unarchiveRejection)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      archive.archiveSession(sid('two'))
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('session archive rejected:', archiveRejection) })
      archive.unarchiveSession(sid('two'))
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('session unarchive rejected:', unarchiveRejection) })
    } finally {
      warn.mockRestore()
    }
    // A rejected archive raises no notice.
    expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'archived', sessionId: 'one', seq: 1 })
  })

  it('turns the Host\'s running-work refusal into the stop-and-archive confirmation, which archives with stopActivity', async () => {
    const b = await bench()
    b.setSessions(sessionState([{ ...summary('busy', 3), displayTitle: 'Busy session' }]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const activity = [{ kind: 'turn' as const }, { kind: 'job' as const, items: [{ id: 'bash-1', label: 'pnpm run build' }] }]
    const refusal = Object.assign(new Error('workspace session archive failed: workspace/session-active: active'), {
      name: 'WorkspaceArchiveError',
      rpcError: new RemoteError('workspace/session-active', 'active', { sessionId: sid('busy'), activity }),
    })
    const archiveSession = vi.spyOn(b.ctx.uiWorkspace, 'archiveSession')
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce(undefined)
    const archive = faceOf(entry(b.slots, ROW_ACTION, 'archive')) as ArchiveSessionInjected
    const confirm = faceOf(entry(b.slots, 'shell.overlay', 'workspace.session-archive')) as SessionArchiveConfirmInjected
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      archive.archiveSession(sid('busy'))
      await vi.waitFor(() => {
        expect(confirm.hooks.archiveRequest.getSnapshot()).toEqual({ sessionId: 'busy', displayTitle: 'Busy session', activity })
      })
      // The refusal is a question, not a diagnostic, and nothing is archived yet.
      expect(warn).not.toHaveBeenCalled()
      expect(toast.hooks.toast.getSnapshot()).toBeNull()
      expect(archiveSession).toHaveBeenCalledWith('busy')

      // Cancelling settles the request; confirming asks the Host to stop the work.
      confirm.settleSessionArchive()
      expect(confirm.hooks.archiveRequest.getSnapshot()).toBeNull()
      await confirm.stopAndArchiveSession(sid('busy'))
      expect(archiveSession).toHaveBeenLastCalledWith('busy', { stopActivity: true })
      expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'stoppedAndArchived', sessionId: 'busy', seq: 1 })
    } finally {
      warn.mockRestore()
    }
  })

  it('the switch row raises the request, and the dialog share maps every outcome of moving the Session', async () => {
    const b = await bench()
    b.setSessions(sessionState([{ ...summary('source', 3), displayTitle: 'Source session' }]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const row = faceOf(entry(b.slots, MENU_ITEM, 'switch-workspace')) as SwitchWorkspaceInjected
    const dialog = faceOf(entry(b.slots, 'shell.overlay', 'workspace.workspace-switch')) as WorkspaceSwitchDialogInjected
    const switchWorkspace = vi.spyOn(b.ctx.uiWorkspace, 'switchWorkspace').mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(dialog.hooks.switchRequest.getSnapshot()).toBeNull()
      row.requestWorkspaceSwitch(sid('source'), 'Source session')
      expect(dialog.hooks.switchRequest.getSnapshot()).toEqual({ sessionId: 'source', displayTitle: 'Source session' })

      await expect(dialog.switchWorkspace(sid('source'), 'other' as WorkspaceId)).resolves.toEqual({ status: 'switched' })
      expect(switchWorkspace).toHaveBeenCalledWith('source', 'other')

      switchWorkspace.mockRejectedValueOnce(failure('workspace/session-active', { sessionId: sid('source'), activity: [{ kind: 'turn' }] }))
      await expect(dialog.switchWorkspace(sid('source'), 'other' as WorkspaceId)).resolves.toEqual({ status: 'busy' })
      switchWorkspace.mockRejectedValueOnce(failure('workspace/session-in-use', { sessionId: sid('source') }))
      await expect(dialog.switchWorkspace(sid('source'), 'other' as WorkspaceId)).resolves.toEqual({ status: 'in-use' })
      expect(warn).not.toHaveBeenCalled()

      switchWorkspace.mockRejectedValueOnce(new Error('fork refused'))
      await expect(dialog.switchWorkspace(sid('source'), 'other' as WorkspaceId))
        .resolves.toEqual({ status: 'failed', message: 'fork refused' })
      switchWorkspace.mockRejectedValueOnce('plain failure')
      await expect(dialog.switchWorkspace(sid('source'), 'other' as WorkspaceId))
        .resolves.toEqual({ status: 'failed', message: 'plain failure' })
      expect(warn).toHaveBeenCalledTimes(2)

      dialog.settleWorkspaceSwitch()
      expect(dialog.hooks.switchRequest.getSnapshot()).toBeNull()
    } finally {
      warn.mockRestore()
      switchWorkspace.mockRestore()
    }
  })

  it('the delete row raises the confirmation, and the dialog share maps every Host outcome', async () => {
    const b = await bench()
    b.setSessions(sessionState([{ ...summary('doomed', 3), displayTitle: 'Doomed session' }]))
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const row = faceOf(entry(b.slots, MENU_ITEM, 'delete')) as DeleteSessionInjected
    const dialog = faceOf(entry(b.slots, 'shell.overlay', 'workspace.session-delete')) as SessionDeleteDialogInjected
    const deleteSession = vi.spyOn(b.ctx.uiWorkspace, 'deleteSession').mockResolvedValue(undefined)
    const activity = [{ kind: 'turn' as const }]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(dialog.hooks.deleteRequest.getSnapshot()).toBeNull()
      row.requestSessionDelete(sid('doomed'), 'Doomed session')
      expect(dialog.hooks.deleteRequest.getSnapshot()).toEqual({ sessionId: 'doomed', displayTitle: 'Doomed session' })

      await expect(dialog.deleteSession(sid('doomed'), { stopActivity: false })).resolves.toEqual({ status: 'deleted' })
      expect(deleteSession).toHaveBeenLastCalledWith('doomed', { stopActivity: false })

      deleteSession.mockRejectedValueOnce(failure('workspace/session-active', { sessionId: sid('doomed'), activity }))
      await expect(dialog.deleteSession(sid('doomed'), { stopActivity: false })).resolves.toEqual({ status: 'active', activity })
      deleteSession.mockRejectedValueOnce(failure('workspace/session-in-use', { sessionId: sid('doomed') }))
      await expect(dialog.deleteSession(sid('doomed'), { stopActivity: true })).resolves.toEqual({ status: 'in-use' })
      expect(warn).not.toHaveBeenCalled()

      deleteSession.mockRejectedValueOnce(failure('session/not-found', { sessionId: sid('doomed') }))
      await expect(dialog.deleteSession(sid('doomed'), { stopActivity: false }))
        .resolves.toEqual({ status: 'failed', message: 'workspace session delete failed: session/not-found' })
      deleteSession.mockRejectedValueOnce('plain failure')
      await expect(dialog.deleteSession(sid('doomed'), { stopActivity: false }))
        .resolves.toEqual({ status: 'failed', message: 'plain failure' })
      expect(warn).toHaveBeenCalledTimes(2)

      dialog.settleSessionDelete()
      expect(dialog.hooks.deleteRequest.getSnapshot()).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('the notice share takes the notice down, undoes an archive, and shows the archived rows', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const unarchiveSession = vi.spyOn(b.ctx.uiWorkspace, 'unarchiveSession').mockResolvedValue(undefined)
    const toast = faceOf(entry(b.slots, 'shell.overlay', 'workspace.row-toast')) as RowToastInjected
    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    const view = viewInstance(b.slots)

    // The browser raises the not-openable notice into the same entry, and the source notifies.
    expect(toast.hooks.toast.getSnapshot()).toBeNull()
    const noticed = vi.fn()
    const unsubscribe = toast.hooks.toast.subscribe(noticed)
    browser.notifyArchivedNotOpenable()
    expect(toast.hooks.toast.getSnapshot()).toEqual({ kind: 'archivedNotOpenable', seq: 1 })
    expect(noticed).toHaveBeenCalledOnce()
    toast.dismissToast()
    expect(toast.hooks.toast.getSnapshot()).toBeNull()
    unsubscribe()

    expect(view.getSnapshot().archivedFilter).toBe('default')
    toast.showArchived()
    expect(view.getSnapshot().archivedFilter).toBe('show')

    toast.undoArchive(sid('one'))
    expect(unarchiveSession).toHaveBeenCalledWith('one')
    // A rejected undo is a console diagnostic.
    const rejection = new Error('unarchive exploded')
    unarchiveSession.mockRejectedValueOnce(rejection)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      toast.undoArchive(sid('two'))
      await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('session unarchive rejected:', rejection) })
    } finally {
      warn.mockRestore()
    }
  })

  it('routes fork and rename through their shares, the rename dialog, and the browser face', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'shell.overlay')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const unarchiveSession = vi.spyOn(b.ctx.uiWorkspace, 'unarchiveSession').mockResolvedValue(undefined)

    // Fork goes through the navigation service, which leaves the child unselected.
    const forkSession = vi.spyOn(b.ctx.uiWorkspace, 'forkSession')
    const fork = faceOf(entry(b.slots, MENU_ITEM, 'fork')) as ForkSessionInjected
    b.retain.mockClear()
    fork.forkSession('session' as never)
    await forkSession.mock.results[0]!.value
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'session', increaseTitle: true, onCreated: expect.any(Function) as (childId: SessionId) => void })
    expect(b.retain).not.toHaveBeenCalled()

    // The rename row raises the request the dialog entry reads; settling clears it.
    const rename = faceOf(entry(b.slots, MENU_ITEM, 'rename')) as RenameSessionInjected
    const dialog = faceOf(entry(b.slots, 'shell.overlay', 'workspace.session-rename')) as SessionRenameDialogInjected
    expect(dialog.hooks.renameRequest.getSnapshot()).toBeNull()
    const requested = vi.fn()
    const unsubscribeRequest = dialog.hooks.renameRequest.subscribe(requested)
    rename.requestSessionRename('session' as never, 'Old title')
    expect(dialog.hooks.renameRequest.getSnapshot()).toEqual({ sessionId: 'session', currentTitle: 'Old title' })
    expect(requested).toHaveBeenCalled()
    unsubscribeRequest()
    dialog.settleSessionRename()
    expect(dialog.hooks.renameRequest.getSnapshot()).toBeNull()
    // The dialog's rename hop reaches the Session face and rethrows a business error.
    await dialog.renameSession('session' as never, 'renamed session')
    expect(b.using).toHaveBeenCalledWith('session', { source: 'workspaceOperation' }, expect.any(Function))
    expect(b.renameSession).toHaveBeenCalledWith('renamed session')
    b.renameSession.mockResolvedValueOnce({
      ok: false, error: new RemoteError('gateway/internal', 'title write failed', {}),
    } as never)
    await expect(dialog.renameSession('session' as never, 'again')).rejects.toThrow('title write failed')

    // The browser raises the same rename request from a title double-click,
    // restores from its search results, and carries none of the row verbs itself.
    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    browser.requestSessionRename('session' as never, 'Row title')
    expect(dialog.hooks.renameRequest.getSnapshot()).toEqual({ sessionId: 'session', currentTitle: 'Row title' })
    for (const verb of ['forkSession', 'archiveSession', 'pinSession', 'unpinSession', 'renameSession', 'undoArchive', 'showArchived']) {
      expect(browser).not.toHaveProperty(verb)
    }
    await browser.unarchiveSession('session' as never)
    expect(unarchiveSession).toHaveBeenCalledWith('session')
  })

  it('routes browser actions and picker creation to the services', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const startSession = vi.spyOn(b.ctx.uiWorkspace, 'startSession').mockImplementation(() => undefined)

    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    // The browser share delegates to the shared Session navigation action.
    browser.startSession('ws' as never)
    expect(startSession).toHaveBeenLastCalledWith('ws')
    browser.startSession()
    expect(startSession).toHaveBeenLastCalledWith(undefined)
    browser.open('session' as never)
    expect(b.retain).toHaveBeenCalledWith('session', { source: 'mainView' })
    const signal = new AbortController().signal
    await expect(browser.searchSessions('match', signal)).resolves.toEqual({
      items: [{ sessionId: 'session', snippet: 'match' }],
      hasMore: false,
    })
    expect(b.search).toHaveBeenCalledWith('match', signal)
    expect(browser.searchResultLimit).toBe(20)
    await browser.renameWorkspace('ws' as never, 'renamed')
    expect(b.rename).toHaveBeenCalledWith('ws', 'renamed')
    await browser.createWorkspace({ path: '/tmp/browser-project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/browser-project' })

    const picker = faceOf(b.slots.entries('conversation.hero.workspace')[0]!) as WorkspacePickerInjected
    await picker.createWorkspace({ path: '/tmp/project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/project' })
  })

  it('declares the browser child slots and reports directory-flow occupancy per surface', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Registration declared the child holes (declaration = render authorization).
    expect(b.slots.spec('sidebar.workspaces.directoryFlow')).toMatchObject({ kind: 'single' })
    expect(b.slots.spec('conversation.hero.workspace.directoryFlow')).toMatchObject({ kind: 'single' })

    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    const picker = faceOf(b.slots.entries('conversation.hero.workspace')[0]!) as WorkspacePickerInjected
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    expect(browser.hooks.hostInfo.getSnapshot()).toMatchObject({ home: undefined })
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    // A flow occupant flips exactly its own surface, and the source notifies.
    const notified = vi.fn()
    const unsubscribe = browser.hooks.directoryFlow.subscribe(notified)
    const dispose = b.slots.register({ name: 'sidebar.workspaces.directoryFlow' } as never, () => null)
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(true)
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    await Promise.resolve()
    expect(notified).toHaveBeenCalled()
    dispose()
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    unsubscribe()
  })

  it('rejects the browser search callback on a Session Controller business error', async () => {
    const b = await bench()
    b.search.mockImplementationOnce(async () => ({
      ok: false,
      error: new RemoteError('gateway/internal', 'index unavailable', {}),
    }) as never)
    declare(b.slots, 'sidebar.workspaces')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const browser = faceOf(b.slots.entries('sidebar.workspaces')[0]!) as WorkspaceBrowserInjected
    await expect(browser.searchSessions('needle', new AbortController().signal))
      .rejects.toThrow('index unavailable')
  })

  it('unregisters every entry on teardown', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace', 'conversation.empty.workspace', 'shell.overlay')
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(MENU_ITEM)).toHaveLength(7)
    expect(b.slots.entries(ROW_ACTION)).toHaveLength(2)
    expect(b.slots.entries('shell.overlay')).toHaveLength(5)
    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.workspace')).toHaveLength(0)
    // The row lists collapse with the browser declaration; the overlay list
    // (declared by the shell) keeps no ui-workspace entry behind.
    expect(b.slots.spec(MENU_ITEM)).toBeUndefined()
    expect(b.slots.entries(MENU_ITEM)).toHaveLength(0)
    expect(b.slots.entries(ROW_ACTION)).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
