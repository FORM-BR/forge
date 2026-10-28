/** Release notice for Web and source installs, beside the settings button; the Desktop app keeps its own updater. */
import { useState } from 'react'
import { IconDownloadOutlineRegular, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WebUpdateNotice.module.css'
import type { WebUpdateView } from '../types.ts'

type SettingsTranslate = PropsLocale<'settings'>['t']

/** Shell commands of a source update, shown verbatim in every language. */
const UPDATE_SCRIPT = 'atualizar-forge.bat'
const UPDATE_COMMANDS: readonly string[] = ['git pull', 'pnpm install', 'pnpm run build']

/**
 * Render the "new version" chip and its action popover.
 * @param props - sidebar width, connection priority, localized copy, shared notice state and its two actions.
 * @returns a tinted-text chip opening the popover, or nothing while there is no notice.
 */
export function WebUpdateNotice({ wide, hidden, t, view, onDismiss, onOpenRelease }: {
  wide: boolean
  hidden: boolean
  t: SettingsTranslate
  view: WebUpdateView
  onDismiss: () => void
  onOpenRelease: (url: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [how, setHow] = useState(false)
  const { notice } = view
  if (!wide || hidden || notice === undefined) return null
  const title = t('webUpdate.title', { version: notice.version })
  const close = (): void => {
    setOpen(false)
    setHow(false)
  }
  const actions: readonly MenuEntry[] = [
    { type: 'label', id: 'title', text: title },
    { id: 'news', label: t('webUpdate.news') },
    { id: 'how', label: t('webUpdate.how') },
    { type: 'separator', id: 'rule' },
    { id: 'dismiss', label: t('webUpdate.dismiss') },
  ]
  const steps: readonly MenuEntry[] = [
    { type: 'label', id: 'steps-title', text: t('webUpdate.how.title') },
  ]
  return <Menu portal side="top" open={open} onClose={close} autoFocus
    listClassName={css.list}
    items={how ? steps : actions}
    onSelect={(id) => {
      if (id === 'news') {
        onOpenRelease(notice.releaseUrl)
        close()
      } else if (id === 'how') {
        setHow(true)
      } else {
        onDismiss()
        close()
      }
    }}
    anchor={<button type="button" className={css.chip} aria-label={title} aria-haspopup="menu" aria-expanded={open}
      onClick={() => { if (open) close(); else setOpen(true) }}>
      <IconDownloadOutlineRegular size={14} />
      <span>{t('webUpdate.chip', { version: notice.version })}</span>
    </button>}>
    {how && <div className={css.steps}>
      <p>{t('webUpdate.how.option1')}</p>
      <code className={css.code}>{UPDATE_SCRIPT}</code>
      <p>{t('webUpdate.how.option2')}</p>
      {UPDATE_COMMANDS.map(command => <code key={command} className={css.code}>{command}</code>)}
      <button type="button" role="menuitem" className={css.back} onClick={() => { setHow(false) }}>
        {t('webUpdate.how.back')}
      </button>
    </div>}
  </Menu>
}
