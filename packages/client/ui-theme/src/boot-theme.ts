/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference, content font size,
 * and Look. Head CSS colors the document canvas (in the Look palette) before
 * script execution; the body script installs the palette selector, font size,
 * and Look attributes that the client presenters adopt.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_FONT_SIZE, DEFAULT_LOOK, DEFAULT_PREFERENCE, type ThemeLook, type ThemePreference,
} from './theme-settings.ts'

/** Canvas color of one palette in each mode; mirrors `--dsw-alias-bg-base` in look.css. */
interface PaletteBackground {
  light: string
  dark: string
}

/** First-paint canvas per palette (`forge` keeps the product canvas). */
export const PALETTE_BACKGROUNDS: Record<ThemeLook['palette'], PaletteBackground> = {
  'forge': { light: '#fff', dark: '#151517' },
  'inform': { light: '#f3f4f6', dark: '#101215' },
  'ocean': { light: '#eef3f8', dark: '#0b141c' },
  'forest': { light: '#eff4f0', dark: '#0d1410' },
  'coffee': { light: '#f3f1ef', dark: '#16120f' },
  'tokyo-night': { light: '#e1e2e7', dark: '#1a1b26' },
  'catppuccin': { light: '#eff1f5', dark: '#1e1e2e' },
  'nord': { light: '#eceff4', dark: '#2e3440' },
  'gruvbox': { light: '#fbf1c7', dark: '#282828' },
  'rose-pine': { light: '#faf4ed', dark: '#191724' },
  'dracula': { light: '#fffbeb', dark: '#282a36' },
  'solarized': { light: '#fdf6e3', dark: '#002b36' },
}

/** CSS that colors the document canvas before any script executes. */
function bootThemeStyle(preference: ThemePreference, palette: ThemeLook['palette']): string {
  const { light: lightBackground, dark: darkBackground } = PALETTE_BACKGROUNDS[palette]
  const light = `:root{color-scheme:light}body{background-color:${lightBackground};--dsh-boot-bg:${lightBackground}}`
  const dark = `:root{color-scheme:dark}body{background-color:${darkBackground};--dsh-boot-bg:${darkBackground}}`
  if (preference === 'light') return light
  if (preference === 'dark') return dark
  return `${light}@media(prefers-color-scheme:dark){${dark}}`
}

/** Build the body script that installs the palette selector, content size, and Look attributes. */
function bootThemeBodyScript(preference: ThemePreference, fontSize: number, look: ThemeLook): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.dataset.dsThemeSource = preference
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${fontSize}px`)})
  for (const [field, value] of Object.entries(${JSON.stringify(look)})) document.body.setAttribute('data-dsh-' + field, value)
})()`
}

/**
 * Theme bootstrap rows: head CSS colors the document canvas before
 * first paint, then the body script installs the palette selector, font
 * size, and Look attributes before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @param look - Current Host-backed Look.
 * @returns head and body script rows in execution order.
 */
export function bootThemeInjections(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
  look: ThemeLook = DEFAULT_LOOK,
): IndexInjection[] {
  return [
    { kind: 'style', text: bootThemeStyle(preference, look.palette) },
    { kind: 'script', placement: 'body', text: bootThemeBodyScript(preference, fontSize, look) },
  ]
}
