/**
 * Workspace business profile surfaces: the "Workspace profile" rows of a
 * Workspace's "..." menu (`sidebar.workspaces.workspace.menu.item`) and the
 * small badge after the Workspace title (`sidebar.workspaces.workspace.badge`).
 *
 * A profile is an agent preset bound to a Workspace directory. Choosing one
 * here only records the association; the preset reaches a session when a new
 * blank session opens in that Workspace (see `AgentPresetSeatController`), and
 * picking another preset on that session stays possible. Developer tools are
 * the single gate over preset selection, so with them off neither surface
 * renders.
 */

import { useEffect, useState } from 'react'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutlineRegular, IconCheckOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the Workspace UI SlotMap merge (the workspace menu and badge seats).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './WorkspaceProfile.module.css'

/** Registration-side business face shared by the menu rows and the badge. */
export interface WorkspaceProfileInjected {
  hooks: {
    /** Shared Developer tools preference; off hides both surfaces. */
    developerTools: ObservableSnapshot<boolean>
    /** Roster snapshot (options and profiles) bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster. */
  load: () => Promise<void>
  /** Set or clear one Workspace's profile; resolves to the failure message, or undefined once saved. */
  select: (workspacePath: string, id: string | undefined) => Promise<string | undefined>
}

/** Full menu-row props. */
export type WorkspaceProfileMenuProps =
  PropsRuntime<'sidebar.workspaces.workspace.menu.item'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<WorkspaceProfileInjected>

/** Full badge props. */
export type WorkspaceProfileBadgeProps =
  PropsRuntime<'sidebar.workspaces.workspace.badge'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<WorkspaceProfileInjected>

/**
 * The "Workspace profile" rows of the Workspace menu: a heading and one row
 * per selectable preset, plus "None" to fall back to the default.
 * @param props - composed slot props.
 * @returns the rows, or null with Developer tools off or no presets to offer.
 */
export function WorkspaceProfileMenuItems({
  path, useMenuOpenState, useDeveloperTools, useAgentPresets, load, select, t,
}: WorkspaceProfileMenuProps) {
  const developerTools = useDeveloperTools(value => value)
  const options = useAgentPresets(state => state.options)
  const current = useAgentPresets(state => state.workspacePresets[path])
  const [, setMenuOpen] = useMenuOpenState()
  const [failure, setFailure] = useState<string | null>(null)

  // Rows mount when the menu opens, so each opening reads the roster afresh.
  useEffect(() => { void load() }, [load])

  if (!developerTools || options.length === 0) return null

  const choose = (id: string | undefined): void => {
    // The mapping is Host state: a refusal keeps the menu open to say why.
    void select(path, id).then((message) => {
      if (message === undefined) setMenuOpen(false)
      else setFailure(t('workspaceProfileFailed', { reason: message }))
    })
  }
  const mark = (selected: boolean) => selected ? <IconCheckOutlineRegular /> : <span aria-hidden="true" />

  return (
    <>
      <div className={css.heading} role="presentation">
        <IconAgentPresetOutlineRegular size={12} />
        {t('workspaceProfileHeading')}
      </div>
      <MenuItemButton icon={mark(current === undefined)} onSelect={() => { choose(undefined) }}>
        {t('workspaceProfileNone')}
      </MenuItemButton>
      {options.map(option => (
        <MenuItemButton key={option.id} icon={mark(current === option.id)} onSelect={() => { choose(option.id) }}>
          {presetDisplayText(option, t).name}
        </MenuItemButton>
      ))}
      {failure !== null && <div className={css.failure} role="alert">{failure}</div>}
    </>
  )
}

/**
 * The badge after a Workspace title naming its profile.
 * @param props - composed slot props.
 * @returns the badge, or null when the Workspace has no profile or Developer tools are off.
 */
export function WorkspaceProfileBadge({
  path, useDeveloperTools, useAgentPresets, load, t,
}: WorkspaceProfileBadgeProps) {
  const developerTools = useDeveloperTools(value => value)
  const status = useAgentPresets(state => state.status)
  const profile = useAgentPresets(state => state.workspacePresets[path])
  const option = useAgentPresets(state => state.options.find(entry => entry.id === profile))

  // Every Workspace header mounts a badge: only the first read is worth a request.
  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  if (!developerTools || profile === undefined) return null

  if (option === undefined) {
    return <span className={`${css.badge} ${css.missing}`} title={t('workspaceProfileMissing', { name: profile })}>{profile}</span>
  }
  const { name } = presetDisplayText(option, t)
  return <span className={css.badge} title={t('workspaceProfileHint', { name })}>{name}</span>
}
