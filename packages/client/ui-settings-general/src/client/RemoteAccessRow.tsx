/** General Settings control for opening this Forge from a phone through Tailscale. */
import { useEffect, useState } from 'react'
import { Button, Switch, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RemoteAccessRow.module.css'

/** What the Host reports about the switch; mirrors the `remoteAccess` Remote answer. */
export interface RemoteAccessView {
  state: 'off' | 'on' | 'unavailable' | 'needs-login' | 'needs-serve' | 'failed'
  host?: string
  /** Address to open on the phone, with the login token; present only while `on`. */
  url?: string
  /** Page that enables Tailscale Serve; present only with `needs-serve`. */
  link?: string
  detail?: string
}

/** Host operations the row calls, each answering with the resulting state. */
export interface RemoteAccessRowInjected {
  status(): Promise<RemoteAccessView>
  enable(): Promise<RemoteAccessView>
  disable(): Promise<RemoteAccessView>
}

const TAILSCALE_DOWNLOAD = 'https://tailscale.com/download'

/**
 * Render the phone-access switch with its link and the next step when it cannot be on.
 * @param props - Host operations and localized copy.
 * @returns the General Settings row.
 */
export function RemoteAccessRow({ status, enable, disable, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<RemoteAccessRowInjected>) {
  const [view, setView] = useState<RemoteAccessView | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let stale = false
    void status().then((next) => { if (!stale) setView(next) })
    return () => { stale = true }
  }, [status])

  const on = view?.state === 'on'
  const url = view?.state === 'on' ? view.url : undefined
  const change = (next: boolean): void => {
    setBusy(true)
    setCopied(false)
    void (next ? enable() : disable()).then(setView).finally(() => { setBusy(false) })
  }
  const copy = (url: string): void => {
    void writeClipboard(url).then((ok) => { if (ok) setCopied(true) })
  }

  return <div className={css.row}>
    <div className={css.body}>
      <div className={css.title}>{t('remoteAccess.title')}</div>
      <div className={css.description}>{t('remoteAccess.description')}</div>
      {url !== undefined && <div className={css.link}>
        <input className={css.input} readOnly value={url} aria-label={t('remoteAccess.link')}
          onFocus={(event) => { event.currentTarget.select() }} />
        <Button size="sm" onClick={() => { copy(url) }}>
          {copied ? t('remoteAccess.copied') : t('remoteAccess.copy')}
        </Button>
        <div className={css.description}>{t('remoteAccess.linkHint')}</div>
      </div>}
      {view?.state === 'unavailable' && <div className={css.notice} role="status">
        {t('remoteAccess.unavailable')}{' '}
        <a href={TAILSCALE_DOWNLOAD} target="_blank" rel="noreferrer">{t('remoteAccess.install')}</a>
      </div>}
      {view?.state === 'needs-login' && <div className={css.notice} role="status">{t('remoteAccess.needsLogin')}</div>}
      {view?.state === 'needs-serve' && <div className={css.notice} role="status">
        {t('remoteAccess.needsServe')}{' '}
        {view.link !== undefined && <a href={view.link} target="_blank" rel="noreferrer">{t('remoteAccess.enableServe')}</a>}
      </div>}
      {view?.state === 'failed' && <div className={css.notice} role="alert">
        {t('remoteAccess.failed')}{view.detail === undefined ? '' : ` ${view.detail}`}
      </div>}
    </div>
    <Switch checked={on} disabled={busy || view === undefined} label={t('remoteAccess.title')} onChange={change} />
  </div>
}
