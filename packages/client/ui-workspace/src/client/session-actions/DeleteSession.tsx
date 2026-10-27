/**
 * The delete action: a `sidebar.workspaces.session.menu.item` row that raises
 * the confirmation request, and the `shell.overlay` dialog that answers it.
 * Deletion removes the Session's stored log permanently, so the dialog always
 * asks first and says so; a Session with running work is deleted only after a
 * second confirmation that names the work the Host will stop. The dialog lives
 * outside the row menu because the row unmounts with the menu.
 */
import { useState } from 'react'
import type { SessionActivity } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, IconTrashOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DeleteSessionInjected, SessionDeleteDialogInjected, SessionDeleteDialogProps, SessionDeleteRequest,
  SessionMenuItemProps,
} from '../contract/slots.ts'
import browserCss from '../rows/WorkspaceBrowser.module.css'
import { activityLine } from './ArchiveSession.tsx'

/**
 * Menu row (order 1000, after every plugin row): ask for the permanent-deletion confirmation.
 * @param props - owner share, menu open state, and the delete share.
 * @returns the row.
 */
export function DeleteSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, requestSessionDelete, t,
}: SessionMenuItemProps<DeleteSessionInjected>) {
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      danger
      separatorBefore
      icon={<IconTrashOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        requestSessionDelete(sessionId, displayTitle)
      }}
    >
      {t('menu.deleteSession')}
    </MenuItemButton>
  )
}

/**
 * The `shell.overlay` entry: nothing while no deletion is requested,
 * otherwise one dialog per request (keyed by the Session, so a new request
 * starts clean).
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteDialogProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/**
 * One request's dialog. `activity` is set once the Host refused the plain
 * deletion for running work: the same dialog then lists that work and offers
 * stop-and-delete. In-flight and error state die with the request.
 */
function DeleteForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteRequest
  deleteSession: SessionDeleteDialogInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteDialogProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<readonly SessionActivity[] | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId, { stopActivity: activity !== null }).then((outcome) => {
      setDeleting(false)
      if (outcome.status === 'deleted') onSettle()
      else if (outcome.status === 'active') setActivity(outcome.activity)
      else setError(outcome.status === 'in-use' ? t('deleteSession.inUse') : outcome.message)
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('deleteSession.title')}
      description={t('deleteSession.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t(activity === null ? 'deleteSession.action' : 'deleteSession.stopAction')}
          </Button>
        </>
      )}
    >
      {activity !== null && (
        <>
          <p>{t('deleteSession.activeDesc')}</p>
          <ul className={browserCss.archiveActivity} aria-label={t('archive.confirm.activity')}>
            {activity.map((entry, index) => (
              <li key={`${entry.kind}-${String(index)}`}>{activityLine(entry, t)}</li>
            ))}
          </ul>
        </>
      )}
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('deleteSession.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
