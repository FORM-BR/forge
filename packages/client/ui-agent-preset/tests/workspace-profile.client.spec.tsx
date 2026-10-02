// @vitest-environment jsdom
/**
 * Workspace business profiles: the preset bound to a Workspace directory.
 * Three halves: the roster store reads and writes the mapping, the new-session
 * seat starts a blank session in a profiled Workspace on its preset (a
 * person's own pick always wins), and the menu rows and badge show and edit it.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentPresetSeatController } from '../src/client/seat-store.ts'
import { AgentPresetSettingsController, writeWorkspacePreset } from '../src/client/settings-store.ts'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import { WorkspaceProfileBadge, WorkspaceProfileMenuItems } from '../src/client/WorkspaceProfile.tsx'
import type { WorkspaceProfileBadgeProps, WorkspaceProfileMenuProps } from '../src/client/WorkspaceProfile.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const WORKSPACE = 'C:\\Work\\form'
const OTHER_WORKSPACE = 'C:\\Work\\g3'

type SeatSession = Pick<SessionSummary, 'id' | 'blank' | 'projectionValues'>

const PRESETS = [
  { id: 'standard', isDefault: true },
  { id: 'form', name: 'FORM', isDefault: false },
  { id: 'g3', name: 'G3 Lean', isDefault: false },
  { id: 'broken', isDefault: false, broken: 'activation failed' },
]

/** A context answering the roster (with the mutable profile map) and recording preset selections. */
function bench(profiles: Record<string, string>, options: { developerTools?: boolean; refuse?: boolean } = {}) {
  const state = { profiles, refuse: options.refuse === true }
  const select = vi.fn((_session: SessionSummary['id'], preset: string) => Promise.resolve(state.refuse
    ? { ok: false as const, error: new RemoteError('gateway/internal', 'selection refused', {}) }
    : { ok: true as const, value: preset }))
  const mutate = vi.fn((_ns: string, _ops: unknown, _revision: unknown) => Promise.resolve({ ok: true as const, value: { ns: 'agent-preset-registry' } }))
  const ctx = {
    configForms: { developerTools: { enabled: createSnapshotStore(options.developerTools ?? true) } },
    remote: {
      agentPresets: {
        list: () => Promise.resolve({
          ok: true as const,
          value: { presets: PRESETS, workspacePresets: { ...state.profiles } },
        }),
        select,
      },
      settings: { mutate },
    },
  } as unknown as ClientContext
  return { ctx, state, select, mutate }
}

/** A seat over a session the test moves, placed in whatever Workspace `workspacePathOf` answers. */
function seatOver(
  ctx: ClientContext,
  session: { current: SeatSession | undefined },
  workspacePathOf: (id: SessionId) => string | undefined,
) {
  return new AgentPresetSeatController(ctx, () => session.current, { id: undefined, introduce: false }, workspacePathOf)
}

const blank = (id = 'blank', agentPreset: string | null = 'standard'): SeatSession =>
  ({ id: SessionId(id), blank: true, projectionValues: { agentPreset } })

describe('the roster store carries the profiles', () => {
  it('reads the mapping with the roster and clears it for an empty roster', async () => {
    const { ctx } = bench({ [WORKSPACE]: 'form' })
    const controller = new AgentPresetSettingsController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot().workspacePresets).toEqual({ [WORKSPACE]: 'form' })

    const empty = new AgentPresetSettingsController({
      remote: { agentPresets: { list: () => Promise.resolve({ ok: true as const, value: { presets: [] } }) } },
    } as unknown as ClientContext)
    await empty.load()
    expect(empty.store.getSnapshot()).toMatchObject({ status: 'unavailable', workspacePresets: {} })
  })

  it('writes one path-addressed op per change, keyed by the Workspace directory', async () => {
    const { ctx, mutate } = bench({})
    await expect(writeWorkspacePreset(ctx, WORKSPACE, 'form')).resolves.toBeUndefined()
    await expect(writeWorkspacePreset(ctx, WORKSPACE, undefined)).resolves.toBeUndefined()
    expect(mutate.mock.calls).toEqual([
      ['agent-preset-registry', [{ op: 'set', path: ['workspacePresets', WORKSPACE], value: 'form' }], undefined],
      ['agent-preset-registry', [{ op: 'unset', path: ['workspacePresets', WORKSPACE] }], undefined],
    ])
  })

  it('returns the failure message of a refused write and still refreshes', async () => {
    const { ctx, mutate } = bench({})
    mutate.mockResolvedValueOnce({ ok: false, error: new RemoteError('settings/rejected', 'read-only profile', { ns: 'agent-preset-registry' }) } as never)
    const controller = new AgentPresetSettingsController(ctx)
    await expect(controller.setWorkspacePreset(WORKSPACE, 'form')).resolves.toBe('read-only profile')
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('refreshes the stored mapping after a successful write', async () => {
    const { ctx, state } = bench({})
    const controller = new AgentPresetSettingsController(ctx)
    state.profiles = { [WORKSPACE]: 'g3' }
    await expect(controller.setWorkspacePreset(WORKSPACE, 'g3')).resolves.toBeUndefined()
    expect(controller.store.getSnapshot().workspacePresets).toEqual({ [WORKSPACE]: 'g3' })
  })
})

describe('a blank session starts on its Workspace profile', () => {
  it('selects the profile preset once the roster is read', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' })
    const session = { current: blank() as SeatSession | undefined }
    const seat = seatOver(ctx, session, () => WORKSPACE)
    await seat.load()
    expect(select).toHaveBeenCalledExactlyOnceWith(SessionId('blank'), 'form')
    expect(seat.store.getSnapshot()).toMatchObject({ current: 'form', error: null, busy: false })
  })

  it('leaves a Workspace without a profile on the default', async () => {
    const { ctx, select } = bench({ [OTHER_WORKSPACE]: 'g3' })
    const seat = seatOver(ctx, { current: blank() }, () => WORKSPACE)
    await seat.load()
    const outside = seatOver(ctx, { current: blank() }, () => undefined)
    await outside.load()
    expect(select).not.toHaveBeenCalled()
    expect(seat.store.getSnapshot().current).toBe('standard')
  })

  it('does nothing when the session already runs the profile preset', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' })
    const seat = seatOver(ctx, { current: blank('blank', 'form') }, () => WORKSPACE)
    await seat.load()
    expect(select).not.toHaveBeenCalled()
  })

  it('never touches a started session', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' })
    const started: SeatSession = { ...blank(), blank: false }
    const seat = seatOver(ctx, { current: started }, () => WORKSPACE)
    await seat.load()
    expect(select).not.toHaveBeenCalled()
  })

  it('skips a profile naming a preset that is gone or failed to load', async () => {
    for (const wanted of ['broken', 'deleted']) {
      const { ctx, select } = bench({ [WORKSPACE]: wanted })
      const seat = seatOver(ctx, { current: blank() }, () => WORKSPACE)
      await seat.load()
      expect(select).not.toHaveBeenCalled()
      expect(seat.store.getSnapshot().current).toBe('standard')
    }
  })

  it('is gated by Developer tools like every preset selection', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' }, { developerTools: false })
    const seat = seatOver(ctx, { current: blank() }, () => WORKSPACE)
    await seat.load()
    expect(select).not.toHaveBeenCalled()
  })

  it('keeps a person pick: the profile never overrides it', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' })
    const session = { current: blank() as SeatSession | undefined }
    const seat = seatOver(ctx, session, () => WORKSPACE)
    // The person picks before any profile could apply.
    await seat.select('g3')
    session.current = blank('blank', 'g3')
    await seat.load()
    await seat.apply()
    expect(select.mock.calls.map(call => call[1])).toEqual(['g3'])
  })

  it('treats a pick that changes nothing as the person word as well', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' })
    const session = { current: blank() as SeatSession | undefined }
    const seat = seatOver(ctx, session, () => WORKSPACE)
    await seat.select('standard')
    await seat.load()
    expect(select).not.toHaveBeenCalled()
  })

  it('applies a changed profile to a still-blank session, but not twice for one value', async () => {
    const { ctx, state, select } = bench({ [WORKSPACE]: 'form' })
    const session = { current: blank() as SeatSession | undefined }
    const seat = seatOver(ctx, session, () => WORKSPACE)
    await seat.load()
    session.current = blank('blank', 'form')
    await seat.apply()
    expect(select).toHaveBeenCalledTimes(1)
    state.profiles = { [WORKSPACE]: 'g3' }
    await seat.load()
    expect(select.mock.calls.map(call => call[1])).toEqual(['form', 'g3'])
  })

  it('reports a refusal once and does not retry the same profile on every list change', async () => {
    const { ctx, select } = bench({ [WORKSPACE]: 'form' }, { refuse: true })
    const session = { current: blank() as SeatSession | undefined }
    const seat = seatOver(ctx, session, () => WORKSPACE)
    await seat.load()
    expect(seat.store.getSnapshot()).toMatchObject({ error: 'selection refused', current: 'standard' })
    await seat.apply()
    await seat.apply()
    expect(select).toHaveBeenCalledTimes(1)
  })
})

function menuProps(state: Partial<AgentPresetSettingsState>, options: {
  enabled?: boolean
  select?: (path: string, id: string | undefined) => Promise<string | undefined>
} = {}) {
  const store = createSnapshotStore<AgentPresetSettingsState>({
    status: 'ready',
    error: null,
    options: [{ id: 'form', name: 'FORM' }, { id: 'g3', name: 'G3 Lean' }],
    workspacePresets: {},
    ...state,
  })
  const developerTools = createSnapshotStore(options.enabled ?? true)
  const setMenuOpen = vi.fn()
  const load = vi.fn(() => Promise.resolve())
  const select = vi.fn(options.select ?? (() => Promise.resolve(undefined)))
  const props = {
    path: WORKSPACE,
    workspaceId: 'w1',
    title: 'form',
    load,
    select,
    useAgentPresets: bindSnapshotSelector(store),
    useDeveloperTools: bindSnapshotSelector(developerTools),
    useMenuOpenState: () => [true, setMenuOpen] as const,
    t: (key: keyof typeof en, params?: Record<string, unknown>) => en[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      params !== undefined && name in params ? String(params[name]) : match),
  }
  return { props, store, load, select, setMenuOpen, developerTools }
}

describe('the Workspace menu rows', () => {
  it('lists None and every preset, marking the current profile, and reads the roster on open', async () => {
    const { props, load } = menuProps({ workspacePresets: { [WORKSPACE]: 'g3' } })
    render(<WorkspaceProfileMenuItems {...(props as unknown as WorkspaceProfileMenuProps)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    const rows = screen.getAllByRole('menuitem').map(row => row.textContent)
    expect(rows).toEqual([en.workspaceProfileNone, 'FORM', 'G3 Lean'])
    // The heading is a label above the rows, not a row; the current profile row carries the check glyph.
    expect(screen.getByText(en.workspaceProfileHeading).closest('button')).toBeNull()
    expect(screen.getByText('G3 Lean').closest('button')!.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('FORM').closest('button')!.querySelector('svg')).toBeNull()
  })

  it('saves the chosen preset for this Workspace and closes the menu', async () => {
    const { props, select, setMenuOpen } = menuProps({})
    render(<WorkspaceProfileMenuItems {...(props as unknown as WorkspaceProfileMenuProps)} />)
    fireEvent.click(screen.getByText('FORM'))
    await waitFor(() => { expect(setMenuOpen).toHaveBeenCalledWith(false) })
    expect(select).toHaveBeenCalledExactlyOnceWith(WORKSPACE, 'form')
  })

  it('clears the profile with None', async () => {
    const { props, select } = menuProps({ workspacePresets: { [WORKSPACE]: 'form' } })
    render(<WorkspaceProfileMenuItems {...(props as unknown as WorkspaceProfileMenuProps)} />)
    fireEvent.click(screen.getByText(en.workspaceProfileNone))
    await waitFor(() => { expect(select).toHaveBeenCalledExactlyOnceWith(WORKSPACE, undefined) })
  })

  it('keeps the menu open and says why when the write is refused', async () => {
    const { props, setMenuOpen } = menuProps({}, { select: () => Promise.resolve('read-only profile') })
    render(<WorkspaceProfileMenuItems {...(props as unknown as WorkspaceProfileMenuProps)} />)
    fireEvent.click(screen.getByText('FORM'))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save the workspace profile: read-only profile')
    expect(setMenuOpen).not.toHaveBeenCalled()
  })

  it('renders nothing with Developer tools off or without presets', () => {
    const off = menuProps({}, { enabled: false })
    const view = render(<WorkspaceProfileMenuItems {...(off.props as unknown as WorkspaceProfileMenuProps)} />)
    expect(view.container.innerHTML).toBe('')
    view.unmount()
    const empty = menuProps({ options: [] })
    const bare = render(<WorkspaceProfileMenuItems {...(empty.props as unknown as WorkspaceProfileMenuProps)} />)
    expect(bare.container.innerHTML).toBe('')
  })
})

describe('the Workspace badge', () => {
  it('names the profile preset beside the Workspace', () => {
    const { props } = menuProps({ workspacePresets: { [WORKSPACE]: 'form' } })
    render(<WorkspaceProfileBadge {...(props as unknown as WorkspaceProfileBadgeProps)} />)
    const badge = screen.getByText('FORM')
    expect(badge.getAttribute('title')).toBe('New tasks in this workspace start with FORM')
  })

  it('shows a struck id when the profile names a preset that is gone', () => {
    const { props } = menuProps({ workspacePresets: { [WORKSPACE]: 'deleted' } })
    render(<WorkspaceProfileBadge {...(props as unknown as WorkspaceProfileBadgeProps)} />)
    expect(screen.getByText('deleted').getAttribute('title')).toBe(
      'deleted is no longer available; new tasks in this workspace use the default',
    )
  })

  it('renders nothing for a Workspace without a profile, another Workspace profile, or Developer tools off', () => {
    const none = menuProps({ workspacePresets: { [OTHER_WORKSPACE]: 'g3' } })
    expect(render(<WorkspaceProfileBadge {...(none.props as unknown as WorkspaceProfileBadgeProps)} />).container.innerHTML).toBe('')
    cleanup()
    const off = menuProps({ workspacePresets: { [WORKSPACE]: 'form' } }, { enabled: false })
    expect(render(<WorkspaceProfileBadge {...(off.props as unknown as WorkspaceProfileBadgeProps)} />).container.innerHTML).toBe('')
  })

  it('asks for the roster only while none has been read', async () => {
    const idle = menuProps({ status: 'idle' })
    render(<WorkspaceProfileBadge {...(idle.props as unknown as WorkspaceProfileBadgeProps)} />)
    await waitFor(() => { expect(idle.load).toHaveBeenCalledTimes(1) })
    cleanup()
    const ready = menuProps({})
    render(<WorkspaceProfileBadge {...(ready.props as unknown as WorkspaceProfileBadgeProps)} />)
    await act(async () => { await Promise.resolve() })
    expect(ready.load).not.toHaveBeenCalled()
  })
})
