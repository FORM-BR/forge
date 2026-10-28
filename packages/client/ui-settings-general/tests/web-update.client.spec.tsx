// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopUpdateBadge } from '../src/client/DesktopUpdateIndicator.tsx'
import { WebUpdateNotice } from '../src/client/WebUpdateNotice.tsx'
import { WebUpdateRow } from '../src/client/WebUpdateRow.tsx'
import { en, pt, zh } from './dictionaries.ts'
import type { WebUpdateView } from '../src/types.ts'

afterEach(() => { cleanup() })

type SettingsTranslate = PropsLocale<'settings'>['t']
const t: SettingsTranslate = (key, params) => Object.entries(params ?? {})
  .reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    (en as Record<string, string>)[key] ?? key)

const releaseUrl = 'https://github.com/FORM-BR/forge/releases/tag/v1.2.0'
const view: WebUpdateView = { notice: { version: '1.2.0', releaseUrl } }
const CHIP = 'New FORGE version: v1.2.0'

function notice(overrides: Partial<Parameters<typeof WebUpdateNotice>[0]> = {}) {
  const onDismiss = vi.fn()
  const onOpenRelease = vi.fn()
  const props = { wide: true, hidden: false, t, view, onDismiss, onOpenRelease, ...overrides }
  const rendered = render(<WebUpdateNotice {...props} />)
  return { onDismiss, onOpenRelease, rendered }
}

describe('Web update chip', () => {
  it('renders nothing without a notice, in the rail, or while connection feedback has priority', () => {
    expect(notice({ view: {} }).rendered.container.innerHTML).toBe('')
    cleanup()
    expect(notice({ wide: false }).rendered.container.innerHTML).toBe('')
    cleanup()
    expect(notice({ hidden: true }).rendered.container.innerHTML).toBe('')
  })

  it('is tinted text with an icon, never a dot, and names the version', () => {
    const { rendered } = notice()
    const chip = screen.getByRole('button', { name: CHIP })
    expect(chip.textContent).toBe('New version v1.2.0')
    expect(rendered.container.querySelectorAll('svg')).toHaveLength(1)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the release page from the popover and closes it', () => {
    const { onOpenRelease } = notice()
    fireEvent.click(screen.getByRole('button', { name: CHIP }))
    expect(screen.getByText(CHIP, { selector: '[role="presentation"]' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: "See what's new" }))
    expect(onOpenRelease).toHaveBeenCalledExactlyOnceWith(releaseUrl)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the source-install steps and goes back', () => {
    notice()
    fireEvent.click(screen.getByRole('button', { name: CHIP }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'How to update' }))
    expect(screen.getByText('atualizar-forge.bat')).toBeTruthy()
    for (const command of ['git pull', 'pnpm install', 'pnpm run build']) expect(screen.getByText(command)).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: "See what's new" })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }))
    expect(screen.getByRole('menuitem', { name: 'How to update' })).toBeTruthy()
    expect(screen.queryByText('atualizar-forge.bat')).toBeNull()
  })

  it('dismisses the version', () => {
    const { onDismiss } = notice()
    fireEvent.click(screen.getByRole('button', { name: CHIP }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dismiss this version' }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('toggles from the chip and resets the steps when it closes', () => {
    notice()
    const chip = screen.getByRole('button', { name: CHIP })
    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('menuitem', { name: 'How to update' }))
    fireEvent.click(chip)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(chip)
    expect(screen.getByRole('menuitem', { name: 'How to update' })).toBeTruthy()
  })
})

describe('Web update row', () => {
  function row(setEnabled: (enabled: boolean) => Promise<void>) {
    const unusedHook = (() => { throw new Error('unused') }) as never
    const kit = {
      useSessions: unusedHook, useSessionStatus: unusedHook, usePanelInfo: unusedHook,
      useSessionRetainInfo: () => undefined, useWorkspaces: unusedHook,
      useResource: (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource'],
    }
    const useUpdateNotice = ((select: (value: boolean) => unknown) => select(true)) as never
    return render(<WebUpdateRow {...kit} t={t} setEnabled={setEnabled} useUpdateNotice={useUpdateNotice} />)
  }

  it('shows the accepted state and writes the choice', async () => {
    const setEnabled = vi.fn(async () => {})
    row(setEnabled)
    const toggle = screen.getByRole('switch', { name: 'Notify about new versions' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('reports a refused write', async () => {
    row(async () => { throw new Error('no') })
    fireEvent.click(screen.getByRole('switch', { name: 'Notify about new versions' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.')
  })
})

describe('Rail badge for a Web release', () => {
  function badge(web: WebUpdateView, connection: 'connected' | 'connecting' | 'disconnected') {
    const props = {
      t,
      useDesktopUpdate: ((select: (value: unknown) => unknown) => select({ failed: false, opening: false })) as never,
      useConnectionState: ((select: (value: unknown) => unknown) => select(connection)) as never,
      useWebUpdate: ((select: (value: WebUpdateView) => unknown) => select(web)) as never,
    }
    return render(<DesktopUpdateBadge {...(props as Parameters<typeof DesktopUpdateBadge>[0])} />)
  }

  it('marks the toggle with a download glyph, not a dot, and stays hidden offline or without a notice', () => {
    badge(view, 'connected')
    const mark = screen.getByRole('img', { name: CHIP })
    expect(mark.querySelector('svg')).not.toBeNull()
    cleanup()
    expect(badge(view, 'disconnected').container.innerHTML).toBe('')
    cleanup()
    expect(badge({}, 'connected').container.innerHTML).toBe('')
  })
})

describe('copy', () => {
  it('has the same webUpdate keys in zh, en and pt', () => {
    const keys = (dictionary: Record<string, string>) => Object.keys(dictionary).filter(key => key.startsWith('webUpdate.')).sort()
    expect(keys(en)).toEqual(keys(zh))
    expect(keys(pt)).toEqual(keys(zh))
    expect(pt['webUpdate.title']).toBe('Nova versão do FORGE: v{version}')
    expect(pt['webUpdate.news']).toBe('Ver novidades')
    expect(pt['webUpdate.how']).toBe('Como atualizar')
  })
})
