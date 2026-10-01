// @vitest-environment jsdom
/** Costs tab type, copy, and injected ledger reads follow the plugin lifetime. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { CostsTab } from '../src/client/CostsTab.tsx'
import { CostsTitle } from '../src/client/CostsTitle.tsx'
import type { CostsInjected } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

async function mountPlugin() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('sidebarRightTabs', tabs)
  const entries: {
    name: string
    key?: string
    locale: string
    component: unknown
    inject: (sessionId: SessionId) => unknown
  }[] = []
  const dictionaries = new Map<string, unknown>()
  const byDay = vi.fn(async () => ({ ok: true, value: [{ day: '2026-09-28', costUsd: 0.01, attempts: 2, inputTokens: 100, outputTokens: 50 }] }))
  const byModel = vi.fn(async () => ({ ok: true, value: [{ provider: 'openrouter', model: 'openai/gpt-4o', costUsd: 0.0123, attempts: 2, inputTokens: 100, outputTokens: 50 }] }))
  new TestRemote(ctx, { costs: { byDay, byModel } })
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: Omit<typeof entries[number], 'component'>, component: unknown) => {
      const entry = { ...options, component }
      entries.push(entry)
      return () => { entries.splice(entries.indexOf(entry), 1) }
    },
  } as never)
  ctx.provide('locale', {
    bind: () => (key: string) => key,
    register: (name: string, values: unknown) => { dictionaries.set(name, values); return () => { dictionaries.delete(name) } },
  } as never)
  const fiber = await ctx.plugin({ inject, apply })
  return {
    tabs, entries, dictionaries, byDay, byModel,
    async dispose() { await fiber.dispose(); await ctx.fiber.dispose() },
  }
}

it('registers the costs tab type, guide entry and both seats, then releases them on unload', async () => {
  expect(hostApply).not.toThrow()
  const h = await mountPlugin()
  try {
    const definition = h.tabs.get('costs')!
    expect(definition.title('sidebar://costs')).toBe('title')
    expect(definition.multiple).toBeUndefined()
    expect(definition.guide?.map(entry => [entry.order, entry.title(), entry.description?.()])).toEqual([[25, 'title', 'description']])
    const Icon = definition.guide?.[0]?.icon
    if (Icon === undefined) throw new Error('Costs guide icon was not registered')
    expect(renderToStaticMarkup(createElement(Icon, { size: 18 }))).toContain('width="18"')
    expect(h.dictionaries.get(NS)).toEqual({ en, zh })
    expect(h.entries.map(entry => [entry.name, entry.component, entry.locale])).toEqual([
      ['sidebar.right.pane.tab', CostsTab, NS],
      ['sidebar.right.pane.tab.title', CostsTitle, NS],
    ])
    const sessionId = 'session' as SessionId
    const face = h.entries[0]!.inject(sessionId) as CostsInjected
    await expect(face.byDay()).resolves.toEqual([{ day: '2026-09-28', costUsd: 0.01, attempts: 2, inputTokens: 100, outputTokens: 50 }])
    await expect(face.byModel()).resolves.toEqual([{ provider: 'openrouter', model: 'openai/gpt-4o', costUsd: 0.0123, attempts: 2, inputTokens: 100, outputTokens: 50 }])
    h.byDay.mockResolvedValueOnce({ ok: false, error: { code: 'costs/unavailable', message: 'cost meter service is absent' } } as never)
    await expect(face.byDay()).rejects.toThrow('costs/unavailable')
  } finally {
    await h.dispose()
  }
  expect(h.tabs.get('costs')).toBeUndefined()
  expect(h.entries).toEqual([])
  expect(h.dictionaries.size).toBe(0)
})

it('renders the current Session cost projection and ledger tables', async () => {
  const h = await mountPlugin()
  try {
    const face = h.entries[0]!.inject('session' as SessionId) as CostsInjected
    const props = {
      useProjection: () => ({
        totalCostUsd: 0.0123, attempts: 2, unpricedAttempts: 1,
        byModel: [{ provider: 'openrouter', model: 'openai/gpt-4o', costUsd: 0.0123, attempts: 2, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      }),
      t: (key: string) => key,
      ...face,
    } as never
    const view = render(createElement(CostsTab, props))
    expect(await view.findByText('$0.0123')).toBeTruthy()
    expect(view.getByText('openai/gpt-4o')).toBeTruthy()
    expect(view.getByText('openrouter')).toBeTruthy()
    expect(await view.findByText('2026-09-28')).toBeTruthy()
  } finally { await h.dispose() }
})