/**
 * The pin action of a Workspace header: a `sidebar.workspaces.workspace.menu.item`
 * row that pins or unpins the Workspace in the header switcher's Pinned group.
 * The pin set is a browser-local viewing preference kept in the shared viewing
 * store; it does not touch the Host.
 */
import { IconPinFillRegular, IconPinOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PinWorkspaceMenuItemProps } from '../contract/slots.ts'

/**
 * Menu row: pin the Workspace, or unpin it when it is pinned.
 * @param props - owner share, menu open state, the viewing store, and the locale seat.
 * @returns the row.
 */
export function PinWorkspaceMenuItem({ workspaceId, useMenuOpenState, useStore, actions, t }: PinWorkspaceMenuItemProps) {
  const [, setMenuOpen] = useMenuOpenState()
  const pinned = useStore(state => state.pinnedWorkspaceIds?.includes(workspaceId) === true)
  return (
    <MenuItemButton
      icon={pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        actions.toggleWorkspacePin(workspaceId)
      }}
    >
      {t(pinned ? 'menu.unpinWorkspace' : 'menu.pinWorkspace')}
    </MenuItemButton>
  )
}
