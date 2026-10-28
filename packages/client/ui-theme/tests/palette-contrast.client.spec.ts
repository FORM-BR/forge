/**
 * The Look sheet's contract: every palette keeps its text readable (WCAG 2
 * contrast computed from the literal hex values in look.css), defines the full
 * token set in both modes, mirrors its base color at boot, and the visible-accent
 * mapping never reaches the default Look.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PALETTE_BACKGROUNDS } from '../src/boot-theme.ts'
import { THEME_LOOK_CHOICES } from '../src/theme-settings.ts'
import { parseRules, type CssRule } from './stylesheet-scan.ts'

const css = readFileSync(new URL('../src/styles/look.css', import.meta.url), 'utf8')
const rules = parseRules(css)

const PALETTES = THEME_LOOK_CHOICES.palette.filter(id => id !== 'forge')
const MODES = ['light', 'dark'] as const
const PALETTE_TOKENS = [
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay', '--dsw-alias-bg-module-platform', '--dsw-specific-sidebar-fill',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsh-palette-accent', '--dsh-palette-accent-2',
]

/** The rule whose selector list is exactly the given one. */
function ruleOf(...selectors: string[]): CssRule {
  const found = rules.find(rule => rule.selectors.length === selectors.length && selectors.every((s, i) => rule.selectors[i] === s))
  if (found === undefined) throw new Error(`no rule for ${selectors.join(', ')}`)
  return found
}

/** Declarations of the rule whose selector list is exactly the given one. */
function declarationsOf(...selectors: string[]): Map<string, string> {
  return new Map(ruleOf(...selectors).declarations)
}

function paletteRule(id: string, mode: typeof MODES[number]): Map<string, string> {
  return declarationsOf(`body[data-dsh-palette='${id}']${mode === 'dark' ? '[data-ds-dark-theme]' : ''}`)
}

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

/** WCAG 2 contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

function hexOf(map: Map<string, string>, token: string): string {
  const value = map.get(token)
  if (value === undefined || !/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${token} is not a #rrggbb literal: ${String(value)}`)
  return value
}

/** [foreground token, background token, minimum ratio] */
const CHECKS: [string, string, number][] = [
  ['--dsw-alias-label-primary', '--dsw-alias-bg-base', 7],
  ['--dsw-alias-label-secondary', '--dsw-alias-bg-base', 4.5],
  ['--dsw-alias-label-tertiary', '--dsw-alias-bg-base', 3],
  ['--dsw-alias-label-primary', '--dsw-alias-bg-overlay', 4.5],
  ['--dsh-palette-accent', '--dsw-alias-bg-base', 3],
]

describe('palette contrast', () => {
  it.each(PALETTES.flatMap(id => MODES.map(mode => [id, mode] as const)))('%s %s meets the text and accent minimums', (id, mode) => {
    const palette = paletteRule(id, mode)
    for (const [foreground, background, minimum] of CHECKS) {
      const ratio = contrast(hexOf(palette, foreground), hexOf(palette, background))
      expect(ratio, `${id} ${mode}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum)
    }
  })

  it('the contrast helper matches known WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})

describe('palette definitions', () => {
  it.each(PALETTES.flatMap(id => MODES.map(mode => [id, mode] as const)))('%s %s defines the full token set', (id, mode) => {
    expect([...paletteRule(id, mode).keys()]).toEqual(PALETTE_TOKENS)
  })

  it('leaves the forge palette to the product tokens', () => {
    expect(rules.some(rule => rule.selectors.some(selector => selector.startsWith("body[data-dsh-palette='forge']")))).toBe(false)
  })

  it('mirrors every palette base as its first-paint canvas', () => {
    for (const id of PALETTES) {
      for (const mode of MODES) {
        expect(PALETTE_BACKGROUNDS[id][mode], `${id} ${mode}`).toBe(paletteRule(id, mode).get('--dsw-alias-bg-base'))
      }
    }
  })

  it('exposes bg, text, and accent samples for every palette in both modes, forge included', () => {
    for (const selector of ['body', 'body[data-ds-dark-theme]']) {
      const samples = declarationsOf(selector)
      for (const id of THEME_LOOK_CHOICES.palette) {
        for (const part of ['bg', 'fg', 'accent']) expect(samples.has(`--dsh-swatch-p-${id}-${part}`), `${selector} ${id} ${part}`).toBe(true)
      }
      for (const id of THEME_LOOK_CHOICES.accent.filter(choice => choice !== 'theme')) {
        expect(samples.has(`--dsh-swatch-a-${id}`), `${selector} accent ${id}`).toBe(true)
        expect(samples.has(`--dsh-swatch-a-${id}-2`), `${selector} accent ${id} 2`).toBe(true)
      }
    }
    const light = declarationsOf('body')
    for (const id of THEME_LOOK_CHOICES.backdrop.filter(choice => choice !== 'plain')) {
      expect(light.get(`--dsh-tile-${id}`), id).toMatch(/^url\("data:image\/svg\+xml,/)
      expect(light.get(`--dsh-tile-${id}-size`), id).toMatch(/^\d+px \d+px$/)
    }
  })
})

describe('accents', () => {
  const EXPECTED: Record<string, [light: [string, string], dark: [string, string]]> = {
    graphite: [['#1f2329', '#6b7280'], ['#e8eaed', '#9aa0a6']],
    forge: [['#b45309', '#d97706'], ['#f0a24b', '#fbbf24']],
    inform: [['#14305a', '#0d9488'], ['#f4f7fa', '#2dd4bf']],
    violet: [['#6d28d9', '#7c3aed'], ['#a78bfa', '#c4b5fd']],
    rose: [['#be185d', '#db2777'], ['#f472b6', '#f9a8d4']],
    green: [['#15803d', '#16a34a'], ['#4ade80', '#86efac']],
    cyan: [['#0e7490', '#0891b2'], ['#22d3ee', '#67e8f9']],
  }

  it.each(Object.entries(EXPECTED))('%s publishes its two tones in light and dark', (id, [light, dark]) => {
    const rule = declarationsOf(`body[data-dsh-accent='${id}']`)
    expect(rule.get('--dsh-accent')).toBe(`var(--dsh-swatch-a-${id})`)
    expect(rule.get('--dsh-accent-2')).toBe(`var(--dsh-swatch-a-${id}-2)`)
    expect(declarationsOf('body').get(`--dsh-swatch-a-${id}`)).toBe(light[0])
    expect(declarationsOf('body').get(`--dsh-swatch-a-${id}-2`)).toBe(light[1])
    expect(declarationsOf('body[data-ds-dark-theme]').get(`--dsh-swatch-a-${id}`)).toBe(dark[0])
    expect(declarationsOf('body[data-ds-dark-theme]').get(`--dsh-swatch-a-${id}-2`)).toBe(dark[1])
  })

  it('the theme accent follows the palette accents', () => {
    const rule = declarationsOf("body[data-dsh-accent='theme']")
    expect(rule.get('--dsh-accent')).toBe('var(--dsh-palette-accent)')
    expect(rule.get('--dsh-accent-2')).toBe('var(--dsh-palette-accent-2)')
  })

  it('remaps the product tokens only for an explicit accent or a theme accent on a non-forge palette', () => {
    const selectors = [
      "body[data-dsh-accent]:not([data-dsh-accent='theme'])",
      "body[data-dsh-accent='theme'][data-dsh-palette]:not([data-dsh-palette='forge'])",
    ]
    const visible = declarationsOf(...selectors)
    for (const token of [
      '--dsw-alias-brand-primary', '--dsw-alias-state-business-primary', '--dsw-alias-link',
      '--dsw-alias-brand-primary-new-colorprimary-new-color', '--dsw-alias-label-primary-bluish',
      '--dsw-alias-button-info-fill',
    ]) {
      expect(visible.get(token), token).toBe('var(--dsh-accent)')
    }
    expect(visible.get('--dsw-alias-state-business-tertiary')).toBe(
      'color-mix(in srgb, var(--dsh-accent) 16%, var(--dsw-alias-bg-base))',
    )
    expect(visible.get('--dsw-alias-label-deep-diving')).toBe(
      'color-mix(in srgb, var(--dsh-accent) 75%, var(--dsw-alias-label-primary))',
    )
    expect(visible.get('--dsw-alias-label-deep-diving-shimmer')).toBe(
      'color-mix(in srgb, var(--dsh-accent-2) 45%, var(--dsw-alias-bg-base))',
    )
    // No other rule touches these product tokens: the default Look keeps the product blue.
    const writers = (rule: CssRule): boolean => rule.declarations.some(([property]) =>
      property === '--dsw-alias-state-business-primary' || property === '--dsw-alias-link')
    const visibleRule = ruleOf(...selectors)
    const offenders = rules.filter(rule => writers(rule) && rule !== visibleRule)
    expect(offenders).toEqual([])
  })

  it('darkens the send fill in dark mode so its white glyph stays legible', () => {
    const dark = declarationsOf(
      "body[data-dsh-accent]:not([data-dsh-accent='theme'])[data-ds-dark-theme]",
      "body[data-dsh-accent='theme'][data-dsh-palette]:not([data-dsh-palette='forge'])[data-ds-dark-theme]",
    )
    expect(dark.get('--dsw-alias-button-info-fill')).toContain('black')
    expect(dark.get('--dsw-alias-button-info-hover')).toContain('black')
  })
})

describe('textures', () => {
  it('derive the wash from the palette and publish a tile per texture', () => {
    const base = declarationsOf("body[data-dsh-backdrop]:not([data-dsh-backdrop='plain'])")
    expect(base.get('--dsh-backdrop-wash')).toBe(
      'linear-gradient(135deg, color-mix(in srgb, var(--dsh-accent-2, var(--dsw-alias-state-business-primary)) 8%, var(--dsw-alias-bg-base)), var(--dsw-alias-bg-base) 70%)',
    )
    expect(base.get('--dsh-backdrop-ink')).toBe('color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)')
    for (const id of THEME_LOOK_CHOICES.backdrop.filter(choice => choice !== 'plain')) {
      const rule = declarationsOf(`body[data-dsh-backdrop='${id}']`)
      expect(rule.get('--dsh-backdrop-tile')).toBe(`var(--dsh-tile-${id})`)
      expect(rule.get('--dsh-backdrop-size')).toBe(`var(--dsh-tile-${id}-size)`)
    }
  })
})
