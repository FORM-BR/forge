// @vitest-environment jsdom
/** Workspace pinning: the viewing-store action and the pin row of the Workspace header menu. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { MenuOpenState, PinWorkspaceMenuItemProps } from '../src/client/contract/slots.ts'
import { en, zh } from '../src/client/locales.ts'
import { PinWorkspaceMenuItem } from '../src/client/session-actions/PinWorkspace.tsx'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const wid = (id: string) => id as WorkspaceId

describe('toggleWorkspacePin', () => {
  it('pins most recent first, unpins, and starts from snapshots saved before pinning existed', () => {
    const instance = createWorkspaceViewStore().create()
    expect(instance.getSnapshot().pinnedWorkspaceIds).toBeUndefined()
    instance.actions.toggleWorkspacePin('a')
    instance.actions.toggleWorkspacePin('b')
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual(['b', 'a'])
    instance.actions.toggleWorkspacePin('b')
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual(['a'])
  })
})

describe('PinWorkspaceMenuItem', () => {
  function mountRow(pinned: boolean, t = makeTranslate(en, commonEn)) {
    const instance = createWorkspaceViewStore().create()
    if (pinned) instance.actions.toggleWorkspacePin('alpha')
    const setMenuOpen = vi.fn()
    const state: MenuOpenState = [true, setMenuOpen]
    const props = {
      workspaceId: wid('alpha'), path: '/projects/alpha', title: 'alpha',
      useMenuOpenState: () => state, useStore: bindSnapshotSelector(instance), actions: instance.actions, t,
    } as unknown as PinWorkspaceMenuItemProps
    render(<PinWorkspaceMenuItem {...props} />)
    return { instance, setMenuOpen }
  }

  it('pins an unpinned Workspace and closes the menu', () => {
    const { instance, setMenuOpen } = mountRow(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin workspace' }))
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual(['alpha'])
    expect(setMenuOpen).toHaveBeenCalledWith(false)
  })

  it('unpins a pinned Workspace', async () => {
    const { instance } = mountRow(true)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin workspace' })) })
    expect(instance.getSnapshot().pinnedWorkspaceIds).toEqual([])
  })

  it('speaks Chinese when the locale seat is Chinese', () => {
    mountRow(false, makeTranslate(zh, commonZh))
    expect(screen.getByRole('menuitem', { name: '固定工作区' })).toBeTruthy()
  })
})
