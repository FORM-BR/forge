// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { StyleRow } from '../src/client/StyleRow.tsx'
import type { StyleRowComponentProps } from '../src/client/StyleRow.tsx'
import { en, zh } from '../src/client/locales.ts'
import { createStyleRowStore } from '../src/client/settings-store.ts'
import { DEFAULT_LOOK, THEME_LOOK_CHOICES, THEME_LOOK_FIELDS, type ThemeLook } from '../src/theme-settings.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
// jsdom has no 2d canvas; the preview's constellation then paints nothing.
HTMLCanvasElement.prototype.getContext = () => null

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<StyleRowComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: StyleRowComponentProps['useSessionStatus'] = selector => selector(noAttention)

function mount(look: ThemeLook = DEFAULT_LOOK) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createStyleRowStore().create()
  store.actions.sync(look, 0)
  const setLook = vi.fn()
  const props: StyleRowComponentProps = {
    useSessions: emptySessions(),
    useSessionStatus,
    usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    // Bare keys keep assertions independent of copy; the dictionary is checked separately.
    t: (key: string) => key,
    setLook,
  }
  const view = render(<StyleRow {...props} />)
  return { store, setLook, container: view.container }
}

const pressed = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('StyleRow', () => {
  it('renders the title, description, and one group per Look field in order', () => {
    mount()
    expect(screen.getByText('style.title')).toBeDefined()
    expect(screen.getByText('style.description')).toBeDefined()
    const titles = THEME_LOOK_FIELDS.map(field => screen.getByText(`${field}.title`))
    for (let i = 1; i < titles.length; i += 1) {
      expect(titles[i - 1]!.compareDocumentPosition(titles[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getAllByRole('button')).toHaveLength(THEME_LOOK_FIELDS.reduce((n, f) => n + THEME_LOOK_CHOICES[f].length, 0))
  })

  it('marks the persisted choice of every field as pressed', () => {
    mount({
      palette: 'nord', accent: 'inform', backdrop: 'grid', hero: 'off', working: 'bar', motion: 'indicator', signature: 'off',
    })
    for (const name of ['palette.nord', 'accent.inform', 'backdrop.grid', 'hero.off', 'working.bar', 'motion.indicator', 'signature.off']) {
      expect(pressed(name)).toBe('true')
    }
    for (const name of ['palette.forge', 'accent.theme', 'backdrop.plain', 'hero.constellation', 'working.anvil', 'motion.full', 'signature.on']) {
      expect(pressed(name)).toBe('false')
    }
  })

  it('click drives setLook; selection follows the store mirror, not the click echo', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'working.sparks' }))
    expect(b.setLook).toHaveBeenCalledWith('working', 'sparks')
    expect(pressed('working.anvil')).toBe('true')
    act(() => { b.store.actions.sync({ ...DEFAULT_LOOK, working: 'sparks' }, 1) })
    expect(pressed('working.sparks')).toBe('true')
    expect(pressed('working.anvil')).toBe('false')
  })

  it('shows an aria-hidden square swatch for palette, accent, and texture choices only', () => {
    mount()
    const swatchOf = (name: string) => screen.getByRole('button', { name }).querySelector('span')
    for (const field of ['palette', 'accent', 'backdrop'] as const) {
      for (const choice of THEME_LOOK_CHOICES[field]) {
        expect(swatchOf(`${field}.${choice}`)?.getAttribute('aria-hidden'), `${field}.${choice}`).toBe('true')
      }
    }
    for (const name of ['hero.off', 'working.anvil', 'motion.full', 'signature.on']) expect(swatchOf(name)).toBeNull()
  })

  it('feeds each swatch the sample tokens of its own choice', () => {
    mount()
    const styleOf = (name: string) => screen.getByRole('button', { name }).querySelector('span')?.getAttribute('style') ?? ''
    expect(styleOf('palette.tokyo-night')).toContain('var(--dsh-swatch-p-tokyo-night-bg)')
    expect(styleOf('palette.tokyo-night')).toContain('var(--dsh-swatch-p-tokyo-night-fg)')
    expect(styleOf('palette.tokyo-night')).toContain('var(--dsh-swatch-p-tokyo-night-accent)')
    expect(styleOf('accent.violet')).toContain('var(--dsh-swatch-a-violet)')
    expect(styleOf('accent.theme')).toBe('')
    expect(styleOf('backdrop.hex')).toContain('var(--dsh-tile-hex)')
    expect(styleOf('backdrop.hex')).toContain('var(--dsh-tile-hex-size)')
    expect(styleOf('backdrop.plain')).toBe('')
  })

  it('renders an aria-hidden live preview with the preview copy and nothing focusable', () => {
    const { container } = mount()
    const preview = screen.getByText('preview.headline').closest('[aria-hidden="true"]')
    expect(preview).not.toBeNull()
    for (const key of ['preview.headline', 'preview.signature', 'preview.working', 'preview.link']) {
      expect(preview?.textContent).toContain(key)
    }
    expect(preview?.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull()
    expect(container.firstElementChild?.firstElementChild).toBe(preview)
  })

  it('notes that the system reduced-motion preference wins, in the motion group only', () => {
    mount()
    expect(screen.getAllByText('motion.description')).toHaveLength(1)
    const group = screen.getByText('motion.title').parentElement!
    expect(within(group).getByText('motion.description')).toBeDefined()
  })
})

describe('Style row copy', () => {
  it('every title and choice key exists in the zh source and the en dictionary', () => {
    const keys = [
      'style.title', 'style.description', 'motion.description',
      'preview.headline', 'preview.signature', 'preview.working', 'preview.link',
      ...THEME_LOOK_FIELDS.flatMap(field => [`${field}.title`, ...THEME_LOOK_CHOICES[field].map(choice => `${field}.${choice}`)]),
    ]
    for (const key of keys) {
      expect(Object.keys(zh), key).toContain(key)
      expect(Object.keys(en), key).toContain(key)
    }
  })
})
