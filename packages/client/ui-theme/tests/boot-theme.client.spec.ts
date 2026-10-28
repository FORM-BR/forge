// @vitest-environment jsdom
/** The theme bootstrap injection row and the resulting pre-plugin browser theme. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootThemeInjections, PALETTE_BACKGROUNDS } from '../src/boot-theme.ts'
import { DEFAULT_LOOK, THEME_LOOK_CHOICES, THEME_LOOK_FIELDS, type ThemePreference } from '../src/theme-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

function mockSystemDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
}

function executeBootstrap(preference?: ThemePreference, fontSize?: number): void {
  for (const row of bootThemeInjections(preference, fontSize)) {
    if (row.kind === 'script') runInNewContext(row.text, { document, matchMedia: globalThis.matchMedia })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.dsThemeSource
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.style.removeProperty('--dsh-content-font-size')
})

describe('theme bootstrap row', () => {
  it('colors the body with head CSS before applying body state', () => {
    mockSystemDark(false)
    const [head, body] = bootThemeInjections('dark')
    expect(head).toMatchObject({ kind: 'style' })
    expect(body).toMatchObject({ kind: 'script', placement: 'body' })
    if (head?.kind !== 'style') throw new Error('theme head bootstrap row is not a style')
    expect(head.text).toBe(':root{color-scheme:dark}body{background-color:#151517;--dsh-boot-bg:#151517}')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    if (body?.kind !== 'script') throw new Error('theme body bootstrap row is not a script')
    runInNewContext(body.text, { document, matchMedia: globalThis.matchMedia })
    expect(document.documentElement.dataset.dsThemeSource).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  })

  it('lets durable light override a dark OS and clears stale dark state', () => {
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    mockSystemDark(true)
    const [head] = bootThemeInjections('light')
    if (head?.kind !== 'style') throw new Error('theme head bootstrap row is not a style')
    expect(head.text).toBe(':root{color-scheme:light}body{background-color:#fff;--dsh-boot-bg:#fff}')
    executeBootstrap('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it.each([
    [true, true],
    [false, false],
  ] as const)('resolves system=%s for the body palette', (matches, dark) => {
    mockSystemDark(matches)
    executeBootstrap('system')
    expect(document.documentElement.dataset.dsThemeSource).toBe('system')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
  })

  it('uses a media query for the system canvas palette', () => {
    const [head] = bootThemeInjections('system')
    if (head?.kind !== 'style') throw new Error('theme head bootstrap row is not a style')
    expect(head.text).toBe(
      ':root{color-scheme:light}body{background-color:#fff;--dsh-boot-bg:#fff}'
      + '@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background-color:#151517;--dsh-boot-bg:#151517}}',
    )
  })

  it('defaults to system and falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    executeBootstrap()
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it('writes the durable content font size and defaults it to 14px', () => {
    mockSystemDark(false)
    executeBootstrap('light', 17)
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('17px')
    executeBootstrap('light')
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('14px')
  })

  it('publishes the durable Look as body attributes and defaults it before first paint', () => {
    mockSystemDark(false)
    executeBootstrap('light')
    expect(document.body.getAttribute('data-dsh-accent')).toBe('theme')
    expect(document.body.getAttribute('data-dsh-hero')).toBe('constellation')
    expect(document.body.getAttribute('data-dsh-signature')).toBe('on')
    const look = { ...DEFAULT_LOOK, accent: 'inform', backdrop: 'waves', motion: 'off' } as const
    for (const row of bootThemeInjections('light', 14, look)) {
      if (row.kind === 'script') runInNewContext(row.text, { document, matchMedia: globalThis.matchMedia })
    }
    expect(document.body.getAttribute('data-dsh-accent')).toBe('inform')
    expect(document.body.getAttribute('data-dsh-backdrop')).toBe('waves')
    expect(document.body.getAttribute('data-dsh-motion')).toBe('off')
    for (const field of THEME_LOOK_FIELDS) document.body.removeAttribute(`data-dsh-${field}`)
  })
})

describe('theme bootstrap palette canvas', () => {
  it('colors the first paint with the palette base in both modes', () => {
    for (const palette of THEME_LOOK_CHOICES.palette) {
      const { light, dark } = PALETTE_BACKGROUNDS[palette]
      const look = { ...DEFAULT_LOOK, palette }
      const [lightHead] = bootThemeInjections('light', 14, look)
      const [darkHead] = bootThemeInjections('dark', 14, look)
      if (lightHead?.kind !== 'style' || darkHead?.kind !== 'style') throw new Error('expected style rows')
      expect(lightHead.text).toBe(`:root{color-scheme:light}body{background-color:${light};--dsh-boot-bg:${light}}`)
      expect(darkHead.text).toBe(`:root{color-scheme:dark}body{background-color:${dark};--dsh-boot-bg:${dark}}`)
    }
  })

  it('keeps the product canvas for the forge palette and a distinct canvas for every other one', () => {
    expect(PALETTE_BACKGROUNDS.forge).toEqual({ light: '#fff', dark: '#151517' })
    const others = THEME_LOOK_CHOICES.palette.filter(palette => palette !== 'forge')
    expect(new Set(others.map(palette => PALETTE_BACKGROUNDS[palette].dark)).size).toBe(others.length)
  })

})
