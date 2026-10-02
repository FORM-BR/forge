/** Always-visible safe mode indicator hosted outside the Plugins panel's lifetime. */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginManagerFace } from './manager-store.ts'
import css from './SafeModePill.module.css'

/** The controller's shared state source; the pill only reads the safe mode flag. */
export type SafeModePillFace = {
  hooks: Pick<PluginManagerFace['hooks'], 'pluginManager'>
}

/** Render inputs bound from the shared controller and plugin dictionary. */
export type SafeModePillProps = InjectFace<SafeModePillFace> & PropsLocale<'pluginManager'>

/**
 * Show a discreet pill while the Host runs in safe mode, so a missing third-party plugin is never a mystery.
 * @param props - shared state hook and locale seat.
 * @returns the pill, or null outside safe mode.
 */
export function SafeModePill({ usePluginManager, t }: SafeModePillProps): ReactNode {
  const safeMode = usePluginManager(state => state.safeMode)
  if (!safeMode) return null
  return (
    <div className={css.pill} role="status" title={t('safeModePillTitle')} data-safe-mode-pill>
      <span className={css.dot} aria-hidden="true" />
      {t('safeModePill')}
    </div>
  )
}
