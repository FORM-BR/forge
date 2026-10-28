/** General Settings control for the new-version notice of Web and source installs. */
import { useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WebUpdateRow.module.css'

/** Accepted setting and ordered mutation supplied by the settings owner. */
export interface WebUpdateRowInjected {
  hooks: { updateNotice: ObservableSnapshot<boolean> }
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * Render the "notify about new versions" toggle.
 * @param props - accepted preference, writer and localized copy.
 * @returns the General Settings row.
 */
export function WebUpdateRow({ useUpdateNotice, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<WebUpdateRowInjected>) {
  const enabled = useUpdateNotice(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('webUpdate.setting.title')}</div>
      <div className={css.description}>{t('webUpdate.setting.description')}</div>
      {failed && <div role="alert">{t('webUpdate.setting.error')}</div>}
    </div>
    <Switch checked={enabled} disabled={busy} label={t('webUpdate.setting.title')}
      onChange={(next) => {
        setFailed(false)
        setBusy(true)
        void setEnabled(next).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
