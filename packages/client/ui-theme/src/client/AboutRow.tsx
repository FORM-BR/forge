/**
 * About lines at the end of the General section: the FORM signature and a
 * quiet invitation to inForm. Reads the `signature` choice from the shared
 * Style store and renders nothing when it is off.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createStyleRowStore } from './settings-store.ts'
import css from './AboutRow.module.css'

/** Full component props: runtime share + store share + locale seat (no injected face). */
export type AboutRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createStyleRowStore>>
  & PropsLocale<'settings.theme'>

/**
 * Render the About lines.
 * @param props - composed slot props.
 * @returns the lines, or null while the signature is off.
 */
export function AboutRow({ t, useStore }: AboutRowComponentProps) {
  const signature = useStore(s => s.look.signature)
  if (signature === 'off') return null
  return (
    <div className={css.about}>
      <div>{t('about.made')}</div>
      <div>
        {t('about.invite')}
        {' '}
        <a
          className={css.link}
          href="https://formbr.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('about.linkLabel')}
        >
          {t('about.link')}
        </a>
      </div>
    </div>
  )
}
