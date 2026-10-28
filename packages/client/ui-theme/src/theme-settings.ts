/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 17

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/**
 * Choices of every Look field, in the order the Style row offers them. The
 * first choice of each field is its default.
 */
export const THEME_LOOK_CHOICES = {
  /** Color theme recoloring surfaces, text, and the theme accent; `forge` is the untouched product palette. */
  palette: ['forge', 'inform', 'ocean', 'forest', 'coffee', 'tokyo-night', 'catppuccin', 'nord', 'gruvbox', 'rose-pine', 'dracula', 'solarized'],
  /** Accent tinting buttons, links, focus rings, selection, and the working indicator; `theme` follows the palette. */
  accent: ['theme', 'graphite', 'forge', 'inform', 'violet', 'rose', 'green', 'cyan'],
  /** Wash and texture painted behind the conversation column. */
  backdrop: ['plain', 'dots', 'grid', 'waves', 'contour', 'hex'],
  /** Animated background of the blank New Session screen. */
  hero: ['constellation', 'off'],
  /** Mark shown beside the running Turn clock. */
  working: ['anvil', 'sparks', 'bar'],
  /** Which decorative animations run; the OS reduced-motion preference always wins. */
  motion: ['full', 'indicator', 'off'],
  /** Whether the FORM signature lines render. */
  signature: ['on', 'off'],
} as const

/** Look field names, also their settings-document field names. */
export type ThemeLookField = keyof typeof THEME_LOOK_CHOICES

/** Visual style choices persisted by the Style row and published on `body` as `data-dsh-<field>`. */
export type ThemeLook = { [F in ThemeLookField]: typeof THEME_LOOK_CHOICES[F][number] }

/** Look field names in Style-row order. */
export const THEME_LOOK_FIELDS = Object.keys(THEME_LOOK_CHOICES) as ThemeLookField[]

/** Look when the user-settings document has no override: the first choice of each field. */
export const DEFAULT_LOOK: ThemeLook = Object.freeze({
  palette: 'forge', accent: 'theme', backdrop: 'plain', hero: 'constellation', working: 'anvil', motion: 'full', signature: 'on',
})

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings extends ThemeLook {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
}

/**
 * Build the validated schema of one Look field.
 * @param field - Look field name.
 * @returns a union of the field's choices defaulting to its first choice.
 */
export function lookFieldSchema<F extends ThemeLookField>(field: F): z<ThemeLook[F]> {
  return (z.union([...THEME_LOOK_CHOICES[field]]) as z<ThemeLook[F]>).default(DEFAULT_LOOK[field])
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  palette: lookFieldSchema('palette'),
  accent: lookFieldSchema('accent'),
  backdrop: lookFieldSchema('backdrop'),
  hero: lookFieldSchema('hero'),
  working: lookFieldSchema('working'),
  motion: lookFieldSchema('motion'),
  signature: lookFieldSchema('signature'),
})

/**
 * Narrow one value to an accepted choice of a Look field.
 * @param field - Look field name.
 * @param value - value crossing the settings boundary.
 * @returns whether the value is one of the field's choices.
 */
export function isLookChoice<F extends ThemeLookField>(field: F, value: unknown): value is ThemeLook[F] {
  return (THEME_LOOK_CHOICES[field] as readonly unknown[]).includes(value)
}

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
