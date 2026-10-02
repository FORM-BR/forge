// @vitest-environment jsdom
/** Agent Map registration: tab type, guide entry, seats and navigation actions follow the plugin lifetime. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../src/client/index.ts'
import { AgentMapTab, AgentMapTitle, type AgentMapInjected } from '../src/client/agent-map/AgentMapTab.tsx'
import { AGENT_MAP_ID, AGENT_MAP_KIND } from '../src/client/agent-map/register.ts'
import { en, NS, zh } from '../src/client/locales.ts'

interface SeatEntry {
  readonly name: string
  readonly key?: string
  readonly locale: string
  readonly component: unknown
  readonly inject: (sessionId: SessionId) => unknown
}

async function mountPlugin() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  ctx.provide('sidebarRightTabs', tabs)
  const entries: SeatEntry[] = []
  const calls: { method: string; args: unknown[] }[] = []
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: Omit<SeatEntry, 'component'>, component: unknown) => {
      const entry = { ...options, component }
      entries.push(entry)
      return () => { entries.splice(entries.indexOf(entry), 1) }
    },
  } as never)
  ctx.provide('locale', {
    bind: () => (key: string) => key,
    register: () => () => {},
  } as never)
  ctx.provide('resources', { register: () => () => {} } as never)
  ctx.provide('sessions', {
    refreshProjections: (id: SessionId) => { calls.push({ method: 'refreshProjections', args: [id] }); return Promise.resolve() },
  } as never)
  ctx.provide('uiWorkspace', {
    openSession: (target: unknown) => { calls.push({ method: 'openSession', args: [target] }) },
  } as never)
  ctx.provide('sidebarRight', {
    openResource: (...args: unknown[]) => { calls.push({ method: 'openResource', args }) },
    openTab: (...args: unknown[]) => { calls.push({ method: 'openTab', args }) },
  } as never)
  const fiber = await ctx.plugin({ inject: [...inject], apply })
  return { ctx, tabs, entries, calls, async dispose() { await fiber.dispose(); await ctx.fiber.dispose() } }
}

describe('Agent Map registration', () => {
  it('registers the page type, guide entry and both seats, then releases them on unload', async () => {
    const h = await mountPlugin()
    try {
      const definition = h.tabs.get(AGENT_MAP_KIND)!
      expect(definition.id).toBe(AGENT_MAP_ID)
      expect(definition.title('x')).toBe('map.title')
      expect(definition.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
        .toEqual([[26, 'map.title', 'map.description']])
      const Icon = definition.guide?.[0]?.icon
      if (Icon === undefined) throw new Error('Agent Map guide icon was not registered')
      expect(renderToStaticMarkup(createElement(Icon, { size: 18 }))).toContain('width="18"')
      const seats = h.entries.filter(entry => entry.key === AGENT_MAP_ID)
      expect(seats.map(entry => [entry.name, entry.component, entry.locale])).toEqual([
        ['sidebar.right.pane.tab', AgentMapTab, NS],
        ['sidebar.right.pane.tab.title', AgentMapTitle, NS],
      ])
      const face = seats[0]!.inject('session' as SessionId) as AgentMapInjected
      const address = { parentSessionId: 'p' as SessionId, childSessionId: 'c' as SessionId, mode: 'continuable' as const }
      face.openRoot('p' as SessionId)
      face.openChild(address)
      face.openChildAside(address)
      face.refreshProjection('p' as SessionId)
      face.openMap?.()
      expect(h.calls).toEqual([
        { method: 'openSession', args: ['p'] },
        { method: 'openSession', args: [address] },
        { method: 'openResource', args: [
          'dsh-resource://subagentchat/session/c?parent=p&mode=continuable',
          { kind: 'subagentchat', preferNewPane: true },
        ] },
        { method: 'refreshProjections', args: ['p'] },
        { method: 'openTab', args: [AGENT_MAP_KIND] },
      ])
    } finally {
      await h.dispose()
    }
    expect(h.tabs.get(AGENT_MAP_KIND)).toBeUndefined()
    expect(h.entries.filter(entry => entry.key === AGENT_MAP_ID)).toEqual([])
  })

  it('keeps the dictionaries key-identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
