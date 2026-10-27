/**
 * The switch-workspace action: a `sidebar.workspaces.session.menu.item` row
 * that raises the request, and the `shell.overlay` dialog that lets the user
 * choose the target Workspace. The Session then continues in that Workspace
 * under the same title; only the Workspace shown for it changes. The dialog
 * lives outside the row menu because the row unmounts with the menu.
 */
import { useState } from 'react'
import { Button, IconFolderOpenOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  SwitchWorkspaceInjected, WorkspaceSwitchDialogInjected, WorkspaceSwitchDialogProps, WorkspaceSwitchRequest,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'
import css from '../rows/Rows.module.css'

/**
 * Menu row (order 350): ask for the target-Workspace dialog.
 * @param props - owner share, menu open state, and the switch share.
 * @returns the row.
 */
export function SwitchWorkspaceMenuItem({
  sessionId, displayTitle, useMenuOpenState, requestWorkspaceSwitch, t,
}: SessionMenuItemProps<SwitchWorkspaceInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconFolderOpenOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestWorkspaceSwitch(sessionId, displayTitle)
      }}
    >
      {t('menu.switchWorkspace')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no request is pending, otherwise
 * one dialog per request (keyed by the Session).
 * @param props - the request hook, its settlement, the switch hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function WorkspaceSwitchDialog({
  useSwitchRequest, settleWorkspaceSwitch, switchWorkspace, useWorkspaces, t,
}: WorkspaceSwitchDialogProps) {
  const request = useSwitchRequest(pending => pending)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  if (request === null) return null
  const targets = workspaces.filter(workspace => !workspace.sessionIds.includes(request.sessionId))
  return (
    <SwitchForm
      key={request.sessionId}
      request={request}
      targets={targets.map(workspace => ({ workspaceId: workspace.workspaceId, title: workspace.title, path: workspace.path }))}
      switchWorkspace={switchWorkspace}
      onSettle={settleWorkspaceSwitch}
      t={t}
    />
  )
}

/** One request's dialog: the choice in flight and any failure die with it. */
function SwitchForm({ request, targets, switchWorkspace, onSettle, t }: {
  request: WorkspaceSwitchRequest
  targets: readonly { workspaceId: WorkspaceId; title: string; path: string }[]
  switchWorkspace: WorkspaceSwitchDialogInjected['switchWorkspace']
  onSettle: () => void
  t: WorkspaceSwitchDialogProps['t']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (busy) return
    onSettle()
  }
  const choose = (workspaceId: WorkspaceId) => {
    setBusy(true)
    setError(null)
    switchWorkspace(request.sessionId, workspaceId).then((outcome) => {
      setBusy(false)
      if (outcome.status === 'switched') onSettle()
      else if (outcome.status === 'busy') setError(t('switchWorkspace.busy'))
      else setError(outcome.status === 'in-use' ? t('deleteSession.inUse') : outcome.message)
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('switchWorkspace.title')}
      description={t('switchWorkspace.desc', { title: request.displayTitle })}
      footer={<Button variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>}
    >
      {targets.length === 0
        ? <div className={browserCss.deleteStatus}>{t('switchWorkspace.empty')}</div>
        : (
          <ul className={css.workspaceChoices} aria-label={t('switchWorkspace.list')}>
            {targets.map(target => (
              <li key={target.workspaceId}>
                <Button
                  variant="outline"
                  className={css.workspaceChoice}
                  disabled={busy}
                  title={target.path}
                  onClick={() => { choose(target.workspaceId) }}
                >
                  {target.title}
                </Button>
              </li>
            ))}
          </ul>
        )}
      {busy && <div className={browserCss.deleteStatus} role="status">{t('switchWorkspace.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
