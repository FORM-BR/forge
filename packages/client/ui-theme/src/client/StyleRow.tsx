/**
 * "Forge style" row registered into the General section item slot: a sticky
 * live preview, then one group of segmented buttons per Look field in
 * {@link THEME_LOOK_FIELDS} order. Selection follows the persisted Look
 * mirrored in the store, never the click echo. Palette, accent, and texture
 * choices carry a square swatch that reads the always-defined sample tokens of
 * look.css; the motion group notes that the system reduced-motion preference
 * always wins.
 */
import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { THEME_LOOK_CHOICES, THEME_LOOK_FIELDS, type ThemeLook, type ThemeLookField } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createStyleRowStore } from './settings-store.ts'
import { StylePreview } from './StylePreview.tsx'
import css from './StyleRow.module.css'

/** Injected business face: the Look write (t rides the standard locale seat). */
export interface StyleRowInjected {
  /** Change one Look field to one of its choices. */
  setLook: (field: ThemeLookField, value: ThemeLook[ThemeLookField]) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type StyleRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createStyleRowStore>>
  & PropsLocale<'settings.theme'> & StyleRowInjected

/**
 * Build the swatch that precedes a choice label.
 * @param field - Look field of the group.
 * @param choice - choice the button selects.
 * @returns the aria-hidden swatch, or null for fields without one.
 */
function swatchFor(field: ThemeLookField, choice: string): ReactNode {
  if (field === 'palette') {
    const style = {
      '--sw-bg': `var(--dsh-swatch-p-${choice}-bg)`,
      '--sw-fg': `var(--dsh-swatch-p-${choice}-fg)`,
      '--sw-accent': `var(--dsh-swatch-p-${choice}-accent)`,
    } as CSSProperties
    return <span className={clsx(css.swatch, css.swatchPalette)} style={style} aria-hidden="true" />
  }
  if (field === 'accent') {
    if (choice === 'theme') return <span className={clsx(css.swatch, css.swatchTheme)} aria-hidden="true" />
    const style = { '--sw-accent': `var(--dsh-swatch-a-${choice})` } as CSSProperties
    return <span className={clsx(css.swatch, css.swatchAccent)} style={style} aria-hidden="true" />
  }
  if (field === 'backdrop') {
    const style = { '--sw-tile': `var(--dsh-tile-${choice})`, '--sw-size': `var(--dsh-tile-${choice}-size)` } as CSSProperties
    return (
      <span
        className={clsx(css.swatch, css.swatchTexture, choice !== 'plain' && css.swatchInked)}
        style={choice === 'plain' ? undefined : style}
        aria-hidden="true"
      />
    )
  }
  return null
}

/**
 * Render the Style row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function StyleRow({ t, setLook, useStore }: StyleRowComponentProps) {
  const look = useStore(s => s.look)
  return (
    <div className={css.row}>
      <StylePreview t={t} />
      <div className={css.rowText}>
        <div className={css.title}>{t('style.title')}</div>
        <div className={css.desc}>{t('style.description')}</div>
      </div>
      {THEME_LOOK_FIELDS.map(field => (
        <div key={field} className={css.group}>
          <div className={css.groupTitle}>{t(`${field}.title`)}</div>
          <div className={css.options}>
            {THEME_LOOK_CHOICES[field].map((choice) => {
              const selected = look[field] === choice
              return (
                <button
                  key={choice}
                  type="button"
                  className={clsx(css.option, selected && css.selected)}
                  aria-pressed={selected}
                  onClick={() => { setLook(field, choice) }}
                >
                  {swatchFor(field, choice)}
                  {t(`${field}.${choice}` as ThemeKey)}
                </button>
              )
            })}
          </div>
          {field === 'motion' && <div className={css.note}>{t('motion.description')}</div>}
        </div>
      ))}
    </div>
  )
}
