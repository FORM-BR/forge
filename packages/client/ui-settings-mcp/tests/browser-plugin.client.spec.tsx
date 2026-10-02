// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { McpSettingsTab } from '../src/client/McpSettingsTab.tsx'
import type { McpSettingsTabInjected } from '../src/client/McpSettingsTab.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { servers: [], management: { writable: false, readOnlyReason: 'no-profile' } } as const
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>().mockResolvedValue({ ok: true, value: EMPTY })
  const failure = { ok: false, error: { code: 'mcpStatus/invalid', message: 'bad name', details: { field: 'name' } } } as const
  const save = vi.fn().mockResolvedValue({ ok: true, value: { outcome: 'applied', id: 'mcp-x' } })
  const setEnabled = vi.fn().mockResolvedValue({ ok: true, value: { outcome: 'pending', id: 'mcp-x' } })
  const remove = vi.fn().mockResolvedValue({ ok: false, error: { code: 'mcpStatus/not-found', message: 'gone', details: {} } })
  const openConfigFile = vi.fn().mockResolvedValue({ ok: true, value: { opened: true } })
  save.mockResolvedValueOnce(failure)
  ctx.provide('remote.mcpStatus', { list, save, setEnabled, removeServer: remove, openConfigFile })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, save, setEnabled, remove, openConfigFile }
}

function faceOf(value: Record<string, unknown> | undefined): McpSettingsTabInjected {
  if (value === undefined || typeof value['list'] !== 'function') throw new Error('the tab registers no face')
  return value as typeof value & McpSettingsTabInjected
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-mcp browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.mcpStatus'])
  })

  it('registers a localized tab after the plugin list without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(McpSettingsTab)
    expect(entry.options).toMatchObject({ id: 'mcp', order: 20 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP 服务器')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP servers')
    expect(b.list).not.toHaveBeenCalled()

    const list = entry.inject?.()?.['list']
    if (typeof list !== 'function') throw new Error('the tab registers no list reader')
    const injected = { list: list as McpSettingsTabInjected['list'] }
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('mcpStatus.list failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('wraps the write Remotes, turning a refusal into an action error with its field', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = faceOf(b.slots.entries('settings.plugins.tab')[0]!.inject?.())
    const draft = { name: 'x', transport: 'stdio' as const, command: 'y' }

    await expect(injected.save(draft, undefined)).rejects.toMatchObject({ code: 'mcpStatus/invalid', field: 'name', message: 'bad name' })
    await expect(injected.save(draft, 'mcp-x')).resolves.toEqual({ outcome: 'applied', id: 'mcp-x' })
    expect(b.save).toHaveBeenLastCalledWith(draft, 'mcp-x')
    await expect(injected.setEnabled('mcp-x', false)).resolves.toEqual({ outcome: 'pending', id: 'mcp-x' })
    expect(b.setEnabled).toHaveBeenCalledWith('mcp-x', false)
    await expect(injected.remove('mcp-x')).rejects.toMatchObject({ code: 'mcpStatus/not-found' })
    await expect(injected.openFile('home')).resolves.toBeUndefined()
    expect(b.openConfigFile).toHaveBeenCalledWith('home')
    expect(injected.askAgent).toBeUndefined()
    await b.ctx.fiber.dispose()
  })

  it('offers the assistant only while the agent-preset launcher exists and starts the shipped mcp preset', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    const start = vi.fn()
    let available = false
    b.ctx.provide('agentPresetLauncher', { available: () => available, start })
    const first = faceOf(entry.inject?.())
    expect(first.askAgent?.available).toBe(false)
    available = true
    const second = faceOf(entry.inject?.())
    expect(second.askAgent?.available).toBe(true)
    second.askAgent?.start()
    expect(start).toHaveBeenCalledWith('mcp')
    await b.ctx.fiber.dispose()
  })

  it('recovers across late declaration and declarer reload, and withdraws on disposal', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(McpSettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
