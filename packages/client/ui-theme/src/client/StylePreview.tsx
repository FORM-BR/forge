/**
 * Live preview at the top of the Style row: a miniature of the product (sidebar
 * strip, new-session hero with the constellation, composer, working line,
 * link, and switch). It paints only from the same variables the real surfaces
 * read, so every Look choice shows here the moment it changes, without
 * closing Settings. Decorative: hidden from assistive technology, nothing in
 * it takes focus.
 */
import { ConstellationCanvas, ForgeLogo, ForgeWorkingMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './StylePreview.module.css'

/** Props of the preview: the locale seat of the theme namespace. */
export type StylePreviewProps = PropsLocale<'settings.theme'>

/**
 * Render the preview.
 * @param props - locale seat.
 * @returns the sticky preview element tree.
 */
export function StylePreview({ t }: StylePreviewProps) {
  return (
    <div className={css.sticky} aria-hidden="true">
      <div className={css.preview}>
        <div className={css.side}>
          <span className={css.sideLine} />
          <span className={css.sideActive}><span className={css.sideLine} /></span>
          <span className={css.sideLine} />
        </div>
        <div className={css.main}>
          <span className={css.wash} />
          <span className={css.ink} />
          <ConstellationCanvas className={css.canvas} />
          <div className={css.hero}>
            <ForgeLogo size={22} className={css.logo} />
            <div className={css.headline}>{t('preview.headline')}</div>
            <div className={css.signature}>{t('preview.signature')}</div>
          </div>
          <div className={css.composer}>
            <span className={css.ghost} />
            <span className={css.send}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 10V2.5M2.5 5.5L6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          <div className={css.footer}>
            <span className={css.working}>
              <ForgeWorkingMark />
              <span>{t('preview.working')}</span>
            </span>
            <span className={css.sample}>
              <span className={css.link}>{t('preview.link')}</span>
              <span className={css.switch}><span className={css.thumb} /></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
