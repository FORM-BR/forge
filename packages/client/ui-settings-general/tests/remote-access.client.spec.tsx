// @vitest-environment jsdom
/** The phone-access switch: what each Host answer looks like and what each click asks for. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteAccessRow } from '../src/client/RemoteAccessRow.tsx'
import type { RemoteAccessRowInjected, RemoteAccessView } from '../src/client/RemoteAccessRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const unusedHook = (() => { throw new Error('unused') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, usePanelInfo: unusedHook,
  useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
}

function mount(overrides: Partial<RemoteAccessRowInjected> & { status: RemoteAccessRowInjected['status'] }) {
  const props: RemoteAccessRowInjected = {
    enable: vi.fn(() => Promise.resolve<RemoteAccessView>({ state: 'on', url: 'https://pc.tail1.ts.net/?token=tok' })),
    disable: vi.fn(() => Promise.resolve<RemoteAccessView>({ state: 'off' })),
    ...overrides,
  }
  render(<RemoteAccessRow {...kit} t={t} {...props} />)
  return props
}

const answering = (view: RemoteAccessView) => () => Promise.resolve(view)

describe('phone access row', () => {
  it('is disabled until the Host has answered, then shows the switch off', async () => {
    let answer!: (view: RemoteAccessView) => void
    mount({ status: () => new Promise((resolve) => { answer = resolve }) })
    const toggle = screen.getByRole('switch', { name: en['remoteAccess.title'] })
    expect(toggle.hasAttribute('disabled')).toBe(true)
    answer({ state: 'off', host: 'pc.tail1.ts.net' })
    await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByLabelText(en['remoteAccess.link'])).toBeNull()
  })

  it('switches on, shows the link and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const props = mount({ status: answering({ state: 'off' }) })
    const toggle = await screen.findByRole('switch', { name: en['remoteAccess.title'] })
    await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(toggle)
    expect(props.enable).toHaveBeenCalledTimes(1)
    expect(toggle.hasAttribute('disabled')).toBe(true)
    const link = await screen.findByLabelText<HTMLInputElement>(en['remoteAccess.link'])
    expect(link.value).toBe('https://pc.tail1.ts.net/?token=tok')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.focus(link)
    fireEvent.click(screen.getByText(en['remoteAccess.copy']))
    await waitFor(() => { expect(screen.getByText(en['remoteAccess.copied'])).toBeTruthy() })
    expect(writeText).toHaveBeenCalledWith('https://pc.tail1.ts.net/?token=tok')
  })

  it('does not claim a copy the browser refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    mount({ status: answering({ state: 'on', url: 'https://pc.tail1.ts.net/?token=tok' }) })
    fireEvent.click(await screen.findByText(en['remoteAccess.copy']))
    await waitFor(() => { expect(screen.getByText(en['remoteAccess.copy'])).toBeTruthy() })
    expect(screen.queryByText(en['remoteAccess.copied'])).toBeNull()
  })

  it('switches off and drops the link', async () => {
    const props = mount({ status: answering({ state: 'on', url: 'https://pc.tail1.ts.net/?token=tok' }) })
    const toggle = await screen.findByRole('switch', { name: en['remoteAccess.title'] })
    await screen.findByLabelText(en['remoteAccess.link'])
    fireEvent.click(toggle)
    expect(props.disable).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(screen.queryByLabelText(en['remoteAccess.link'])).toBeNull() })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('says what to do when Tailscale is missing, signed out, or Serve is off', async () => {
    mount({ status: answering({ state: 'unavailable' }) })
    expect(await screen.findByText(en['remoteAccess.unavailable'], { exact: false })).toBeTruthy()
    expect(screen.getByRole('link', { name: en['remoteAccess.install'] }).getAttribute('href')).toBe('https://tailscale.com/download')
    cleanup()

    mount({ status: answering({ state: 'needs-login' }) })
    expect(await screen.findByText(en['remoteAccess.needsLogin'])).toBeTruthy()
    cleanup()

    mount({ status: answering({ state: 'needs-serve', link: 'https://login.tailscale.com/f/serve?node=abc' }) })
    expect(await screen.findByText(en['remoteAccess.needsServe'], { exact: false })).toBeTruthy()
    expect(screen.getByRole('link', { name: en['remoteAccess.enableServe'] }).getAttribute('href'))
      .toBe('https://login.tailscale.com/f/serve?node=abc')
    cleanup()

    mount({ status: answering({ state: 'needs-serve' }) })
    expect(await screen.findByText(en['remoteAccess.needsServe'], { exact: false })).toBeTruthy()
    expect(screen.queryByRole('link', { name: en['remoteAccess.enableServe'] })).toBeNull()
  })

  it('reports a failure with its detail, or without one', async () => {
    mount({ status: answering({ state: 'failed', detail: 'boom' }) })
    expect((await screen.findByRole('alert')).textContent).toBe(`${en['remoteAccess.failed']} boom`)
    cleanup()
    mount({ status: answering({ state: 'failed' }) })
    expect((await screen.findByRole('alert')).textContent).toBe(en['remoteAccess.failed'])
  })

  it('ignores a status answer that arrives after the row is gone', async () => {
    let answer!: (view: RemoteAccessView) => void
    const props: RemoteAccessRowInjected = {
      status: () => new Promise((resolve) => { answer = resolve }),
      enable: vi.fn(),
      disable: vi.fn(),
    }
    const view = render(<RemoteAccessRow {...kit} t={t} {...props} />)
    view.unmount()
    answer({ state: 'on', url: 'https://x/?token=1' })
    await Promise.resolve()
    expect(screen.queryByLabelText(en['remoteAccess.link'])).toBeNull()
  })
})
