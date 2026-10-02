/** The retitle action: one `sidebar.workspaces.session.menu.item` row. */
import { IconSparkleRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RetitleSessionInjected, SessionMenuItemProps } from '../contract/slots.ts'

/**
 * Menu row (order 250): regenerate this Session's title, even when the user
 * renamed it by hand (an explicit request, so the title is automatic again).
 * @param props - owner share, menu open state, and the retitle share.
 * @returns the row.
 */
export function RetitleSessionMenuItem({
  sessionId, useMenuOpenState, retitleSession, t,
}: SessionMenuItemProps<RetitleSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconSparkleRegular />}
      onSelect={() => {
        setMenuOpen(false)
        retitleSession(sessionId)
      }}
    >
      {t('menu.retitleSession')}
    </MenuItemButton>
  )
}
