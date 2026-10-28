/** Host registration for the browser theme preference and pre-plugin palette. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'
import type { ThemeLook, ThemePreference } from './theme-settings.ts'
import z from '@deepseek-ai/schemastery'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootThemeInjections } from './boot-theme.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, FONT_SIZE_MIN, FONT_SIZE_MAX, THEME_PREFERENCES, lookFieldSchema,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_LOOK, DEFAULT_PREFERENCE, FONT_SIZE_FIELD, FONT_SIZE_MAX, FONT_SIZE_MIN,
  THEME_LOOK_CHOICES, THEME_LOOK_FIELDS, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemeLook, type ThemeLookField, type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Browser palette preference. */
  preference: Volatile<ThemePreference>
  /** Browser font size in pixels. */
  fontSize: Volatile<number>
  /** Color theme choice. */
  palette: Volatile<ThemeLook['palette']>
  /** Accent color choice. */
  accent: Volatile<ThemeLook['accent']>
  /** Conversation backdrop choice. */
  backdrop: Volatile<ThemeLook['backdrop']>
  /** New Session background choice. */
  hero: Volatile<ThemeLook['hero']>
  /** Running-Turn mark choice. */
  working: Volatile<ThemeLook['working']>
  /** Decorative animation level. */
  motion: Volatile<ThemeLook['motion']>
  /** FORM signature visibility. */
  signature: Volatile<ThemeLook['signature']>
}

/** Live theme, typography, and style preferences. */
export const Config = z.object({
  preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile(),
  fontSize: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE).volatile(),
  palette: lookFieldSchema('palette').volatile(),
  accent: lookFieldSchema('accent').volatile(),
  backdrop: lookFieldSchema('backdrop').volatile(),
  hero: lookFieldSchema('hero').volatile(),
  working: lookFieldSchema('working').volatile(),
  motion: lookFieldSchema('motion').volatile(),
  signature: lookFieldSchema('signature').volatile(),
})

/** Supply the current palette before browser plugins start.
 * @param ctx Host plugin context.
 * @param config Validated live theme preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    table.push(...bootThemeInjections(config.preference.get(), config.fontSize.get(), {
      palette: config.palette.get(),
      accent: config.accent.get(),
      backdrop: config.backdrop.get(),
      hero: config.hero.get(),
      working: config.working.get(),
      motion: config.motion.get(),
      signature: config.signature.get(),
    }))
  }, { prepend: true })
}
