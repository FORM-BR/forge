/** Central de avisos de fim de turno: o sino flutuante, a lista e as preferências. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { StateDot, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoticeEntry, NotifyController } from './controller.ts'
import css from './TurnNotifyHost.module.css'

/** Namespace do dicionário deste plugin. */
export const NS = 'turnNotify'

/** O que o `apply` injeta no componente. */
export interface TurnNotifyFace {
  readonly controller: NotifyController
}

/** Props completas da entrada em `shell.overlay`. */
export type TurnNotifyHostProps = PropsRuntime<'shell.overlay'> & InjectFace<TurnNotifyFace> & PropsLocale<typeof NS>

/** Sino com a barra de "desligado" quando os avisos estão off. */
function BellIcon({ off }: { off: boolean }): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  )
}

/** "há N min" localizado, sem depender de Intl para ficar igual nos dois idiomas. */
function ago(at: number, now: number, t: TurnNotifyHostProps['t']): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return t('ago.now')
  if (minutes < 60) return t('ago.minutes', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('ago.hours', { n: String(hours) })
  return t('ago.days', { n: String(Math.floor(hours / 24)) })
}

/**
 * @param props - sessões, controlador e dicionário.
 * @returns o sino flutuante com sua central, ou nada fora de uma janela de navegador.
 */
export function TurnNotifyHost({ useSessionStatus, useSessions, controller, t }: TurnNotifyHostProps): ReactNode {
  const statuses = useSessionStatus(snapshot => snapshot)
  const byId = useSessions(state => state.byId)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const labels = useMemo(() => ({ done: t('system.done'), attention: t('system.attention') }), [t])

  useEffect(() => { controller.observe(statuses, byId, labels) }, [controller, statuses, byId, labels])

  useEffect(() => {
    const back = (): void => { if (!document.hidden) controller.returned() }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [controller])

  useEffect(() => {
    if (!open) return undefined
    const away = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const close = (): void => { setOpen(false); controller.markAllRead() }
  const { entries, unread, prefs, permission } = snapshot
  const attentionPending = entries.some(entry => !entry.read && entry.kind === 'attention')
  const now = Date.now()
  const systemHint = permission === 'denied' ? t('hint.blocked') : permission === 'unsupported' ? t('hint.unsupported') : undefined

  return (
    <div className={css.root} ref={rootRef}>
      {open && (
        <section className={css.panel} role="dialog" aria-label={t('title')}>
          <div className={css.head}>
            <h2 className={css.heading}>{t('title')}</h2>
            {unread > 0 && <span className={css.count}>{t('unread', { n: String(unread) })}</span>}
          </div>
          {entries.length === 0
            ? <p className={css.empty}>{t('empty')}</p>
            : (
              <ul className={css.list}>
                {entries.map((entry: NoticeEntry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={clsx(css.item, entry.read && css.read)}
                      onClick={() => { controller.openEntry(entry.id); setOpen(false) }}
                    >
                      <StateDot className={css.dot} state={entry.kind === 'done' ? 'done' : 'warning'} />
                      <span className={css.body}>
                        <span className={css.title}>{entry.title}</span>
                        <span className={css.meta}>{t(entry.kind)} · {ago(entry.at, now, t)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {entries.length > 0 && (
            <div className={css.actions}>
              <button type="button" className={css.link} disabled={unread === 0} onClick={() => { controller.markAllRead() }}>{t('markRead')}</button>
              <button type="button" className={css.link} onClick={() => { controller.clear() }}>{t('clear')}</button>
            </div>
          )}
          <div className={css.prefs}>
            <div className={css.pref}>
              <span>{t('pref.enabled')}</span>
              <Switch checked={prefs.enabled} label={t('pref.enabled')} onChange={(next) => { void controller.setPref('enabled', next) }} />
            </div>
            <div className={css.pref}>
              <span>{t('pref.sound')}</span>
              <Switch checked={prefs.sound} label={t('pref.sound')} disabled={!prefs.enabled} onChange={(next) => { void controller.setPref('sound', next) }} />
            </div>
            <div className={css.pref}>
              <span>{t('pref.system')}</span>
              <Switch checked={prefs.system && permission === 'granted'} label={t('pref.system')} disabled={!prefs.enabled || permission === 'unsupported'} onChange={(next) => { void controller.setPref('system', next) }} />
            </div>
            {systemHint !== undefined && <p className={css.hint}>{systemHint}</p>}
            <div className={css.pref}>
              <span>{t('pref.onlyUnseen')}</span>
              <Switch checked={prefs.onlyUnseen} label={t('pref.onlyUnseen')} disabled={!prefs.enabled} onChange={(next) => { void controller.setPref('onlyUnseen', next) }} />
            </div>
          </div>
        </section>
      )}
      <button
        type="button"
        className={clsx(css.pill, !prefs.enabled && css.off)}
        aria-label={t('bell')}
        aria-expanded={open}
        title={t('bell')}
        onClick={() => { if (open) close(); else setOpen(true) }}
      >
        <BellIcon off={!prefs.enabled} />
        {prefs.enabled && unread > 0 && (
          <span className={clsx(css.badge, attentionPending && css.badgeAttention)}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
    </div>
  )
}
