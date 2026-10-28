/** Appearance, font-size, and Style row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontSizeRowStore, createStyleRowStore } from '../src/client/settings-store.ts'
import { DEFAULT_LOOK } from '../src/theme-settings.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', revision: -1 })
  })

  it('sync mirrors the preference and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', revision: 0 })
    store.actions.sync('light', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 3)
    store.actions.sync('system', 2)
    store.actions.sync('system', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createStyleRowStore', () => {
  it('init shape: default Look with revision at -1', () => {
    const store = createStyleRowStore().create()
    expect(store.getSnapshot()).toEqual({ look: DEFAULT_LOOK, revision: -1 })
  })

  it('sync mirrors the Look; the revision guard drops stale and duplicate writes', () => {
    const store = createStyleRowStore().create()
    const forge = { ...DEFAULT_LOOK, accent: 'forge' as const }
    store.actions.sync(forge, 3)
    expect(store.getSnapshot()).toEqual({ look: forge, revision: 3 })
    store.actions.sync(DEFAULT_LOOK, 2)
    store.actions.sync(DEFAULT_LOOK, 3)
    expect(store.getSnapshot().look).toEqual(forge)
    expect(store.getSnapshot().revision).toBe(3)
  })
})
