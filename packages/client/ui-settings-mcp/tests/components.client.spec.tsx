// @vitest-environment jsdom
import type { McpStatusSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { McpSettingsTab, UNSETTLED_REFRESH_MS } from '../src/client/McpSettingsTab.tsx'
import type { McpSettingsTabInjected, McpSettingsTabProps } from '../src/client/McpSettingsTab.tsx'
import { en, zh, type McpSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = ((key: McpSettingsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as McpSettingsTabProps['t']

function props(list: McpSettingsTabInjected['list']): McpSettingsTabProps {
  return { t, list } as McpSettingsTabProps
}

const READ_ONLY = { writable: false, readOnlyReason: 'no-profile' } as const

const SNAPSHOT: McpStatusSnapshot = {
  servers: [
    { key: 'docs', serverName: 'docs', transport: 'stdio', state: 'connected', toolCount: 3 },
    { key: 'one', serverName: 'one', transport: 'stdio', state: 'connected', toolCount: 1 },
    {
      key: 'web', serverName: 'web', transport: 'streamable-http', host: 'mcp.example.com:8443', state: 'error', toolCount: 2,
      error: 'Connection lost', retry: { attempt: 2, maxAttempts: 10 },
    },
    { key: 'edge', serverName: 'edge', transport: 'streamable-http', state: 'connecting', toolCount: 0 },
    {
      key: 'stuck', serverName: 'stuck', transport: null, state: 'error', toolCount: 0,
      error: 'spawn failed', halted: 'attempts-exhausted',
    },
    { key: 'off', serverName: 'off', transport: 'stdio', state: 'disabled', toolCount: 0 },
    { key: 'bad', serverName: 'bad', transport: null, state: 'error', toolCount: 0, halted: 'load-failed' },
  ],
  management: READ_ONLY,
}

const row = (name: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${name}"]`)
  if (element === null) throw new Error(`no row for ${name}`)
  return element
}

describe('McpSettingsTab', () => {
  it('lists every server with its state, transport, host, and tool count', async () => {
    render(<McpSettingsTab {...props(async () => SNAPSHOT)} />)
    await screen.findByText('7 servers')

    const docs = within(row('docs'))
    expect(docs.getByText('Connected')).toBeTruthy()
    expect(docs.getByText('stdio')).toBeTruthy()
    expect(docs.getByText('3 tools')).toBeTruthy()
    expect(within(row('one')).getByText('1 tool')).toBeTruthy()

    const web = within(row('web'))
    expect(web.getByText('HTTP · mcp.example.com:8443')).toBeTruthy()
    expect(web.getByText('Error')).toBeTruthy()
    expect(within(row('edge')).getByText('HTTP')).toBeTruthy()
    expect(within(row('edge')).getByText('Connecting')).toBeTruthy()
    expect(within(row('stuck')).queryByText('stdio')).toBeNull()
    expect(within(row('off')).getByText('Disabled')).toBeTruthy()
    expect(row('docs').getAttribute('data-state')).toBe('connected')
  })

  it('shows the failure message, the retry counter, and why a server stopped retrying', async () => {
    render(<McpSettingsTab {...props(async () => SNAPSHOT)} />)
    await screen.findByText('7 servers')

    expect(row('web').querySelector('[data-mcp-error]')?.textContent).toContain('Connection lost')
    expect(row('web').querySelector('[data-mcp-retry]')?.textContent).toBe('Reconnecting, attempt 2 of 10')
    expect(row('stuck').querySelector('[data-mcp-halted]')?.textContent).toBe(en.haltAttemptsExhausted)
    expect(row('bad').querySelector('[data-mcp-halted]')?.textContent).toBe(en.haltLoadFailed)
    expect(row('off').textContent).toContain(en.disabledHint)
    expect(row('docs').querySelector('[data-mcp-error]')).toBeNull()
    expect(row('docs').querySelector('[data-mcp-halted]')).toBeNull()
  })

  it.each([
    ['reconnect-disabled', en.haltReconnectDisabled],
    ['transport-unconfirmed', en.haltTransportUnconfirmed],
  ] as const)('explains the %s halt', async (halted, text) => {
    render(<McpSettingsTab {...props(async () => ({
      servers: [{ key: 'x', serverName: 'x', transport: 'stdio', state: 'error', toolCount: 0, halted }],
      management: READ_ONLY,
    }))}
    />)
    await screen.findByText('1 server')
    expect(row('x').querySelector('[data-mcp-halted]')?.textContent).toBe(text)
  })

  it('shows a useful empty state with where to configure a server', async () => {
    render(<McpSettingsTab {...props(async () => ({ servers: [], management: READ_ONLY }))} />)
    const empty = await waitFor(() => {
      const element = document.querySelector('[data-mcp-empty]')
      if (element === null) throw new Error('not rendered yet')
      return element
    })
    expect(empty.textContent).toContain(en.emptyTitle)
    expect(empty.textContent).toContain('cordis.patch.yml')
    expect(empty.querySelector('pre')?.textContent).toContain('@deepseek-ai/dsh-mcp-client')
    expect(screen.queryByRole('button', { name: en.addServer })).toBeNull()
    expect(empty.textContent).toContain(en.emptyBodyReadOnly)
  })

  it('refreshes on demand without blanking the list', async () => {
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce({ servers: [{ key: 'a', serverName: 'a', transport: 'stdio', state: 'connected', toolCount: 1 }], management: READ_ONLY })
      .mockResolvedValueOnce({ servers: [{ key: 'a', serverName: 'a', transport: 'stdio', state: 'connected', toolCount: 5 }], management: READ_ONLY })
    render(<McpSettingsTab {...props(list)} />)
    await screen.findByText('1 tool')
    fireEvent.click(screen.getByRole('button', { name: en.refreshLabel }))
    expect(screen.getByText('1 tool')).toBeTruthy()
    await screen.findByText('5 tools')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows a loading status, then an error with a working retry', async () => {
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('remote down'))
      .mockResolvedValueOnce({ servers: [], management: READ_ONLY })
    render(<McpSettingsTab {...props(list)} />)
    expect(screen.getByRole('status').textContent).toContain(en.loading)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(document.querySelector('[data-mcp-empty]')).not.toBeNull() })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('keeps reading in the background while a server is connecting, and stops once all settle', async () => {
    vi.useFakeTimers()
    const connecting: McpStatusSnapshot = { servers: [{ key: 'a', serverName: 'a', transport: 'stdio', state: 'connecting', toolCount: 0 }], management: READ_ONLY }
    const settled: McpStatusSnapshot = { servers: [{ key: 'a', serverName: 'a', transport: 'stdio', state: 'connected', toolCount: 2 }], management: READ_ONLY }
    const list = vi.fn<McpSettingsTabInjected['list']>()
      .mockResolvedValueOnce(connecting)
      .mockResolvedValueOnce(settled)
    render(<McpSettingsTab {...props(list)} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(row('a').getAttribute('data-state')).toBe('connecting')
    expect(list).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(UNSETTLED_REFRESH_MS) })
    expect(row('a').getAttribute('data-state')).toBe('connected')
    expect(list).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(UNSETTLED_REFRESH_MS * 3) })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('does not poll a halted or healthy list', async () => {
    vi.useFakeTimers()
    const list = vi.fn<McpSettingsTabInjected['list']>().mockResolvedValue({
      servers: [{ key: 'a', serverName: 'a', transport: 'stdio', state: 'error', toolCount: 0, halted: 'reconnect-disabled' }],
      management: READ_ONLY,
    })
    render(<McpSettingsTab {...props(list)} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(UNSETTLED_REFRESH_MS * 3) })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('ignores a read that settles after the tab unmounted', async () => {
    const pending: PromiseWithResolvers<McpStatusSnapshot> = Promise.withResolvers()
    const failing: PromiseWithResolvers<McpStatusSnapshot> = Promise.withResolvers()
    const first = render(<McpSettingsTab {...props(() => pending.promise)} />)
    const second = render(<McpSettingsTab {...props(() => failing.promise)} />)
    first.unmount()
    second.unmount()
    pending.resolve({ servers: [], management: READ_ONLY })
    failing.reject(new Error('late failure'))
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[data-mcp-empty]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the Chinese dictionary through the locale runtime', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const locale = new LocaleRuntime(ctx)
    ctx.effect(() => locale.register('settings.mcp', 'en', en), 'test: English MCP dictionary')
    ctx.effect(() => locale.register('settings.mcp', 'zh', zh), 'test: Chinese MCP dictionary')
    locale.setLocale('zh')
    render(<McpSettingsTab {...{ t: locale.bind('settings.mcp'), list: async () => SNAPSHOT } as McpSettingsTabProps} />)
    await screen.findByText('共 7 个服务器')
    expect(within(row('docs')).getByText('已连接')).toBeTruthy()
    expect(within(row('docs')).getByText('3 个工具')).toBeTruthy()
    expect(row('web').querySelector('[data-mcp-retry]')?.textContent).toBe('正在重连，第 2/10 次尝试')
  })
})
