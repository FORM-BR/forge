// @vitest-environment jsdom
/**
 * The cost report browser plugin lifetime: the Costs sidebar entry and its
 * main panel register with the declared keys, the Remote reads flow through
 * the scripted namespaces with the documented failure translation, and every
 * contribution releases on unload.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ILayout, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { CostReportFilter, CostReportGroup, CostReportModelRow, CostReportRow } from '@deepseek-ai/dsh-api-cost-report/types'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject, NS, PANEL_ID } from '../src/client/index.ts'
import { CostReportPanelIcon } from '../src/client/CostReportPanelIcon.tsx'
import { CostReportPage } from '../src/client/CostReportPage.tsx'
import type { CostReportInjected } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup) // eslint-disable-line @typescript-eslint/no-unsafe-call

const DAY_ROW: CostReportRow[] = [{ day: '2026-09-28', costUsd: 0.5, attempts: 2, inputTokens: 100, outputTokens: 50 }]

/**
 * The cost report fixture provides no global page state; the icon must not
 * depend on it outside the declared owner share.
 */
function unusedStandardHook(): never {
  throw new Error('The cost report fixture does not provide global state')
}

/**
 * A ctx with the real slot registry, a locale service, and the scripted
 * `costReport` Remote namespaces, plus the disposable registrations to remove.
 */
async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const report = vi.fn<() => Promise<{ ok: boolean; value?: readonly CostReportRow[]; error?: { code: string; message: string } }>>()
  const workspaces = vi.fn<() => Promise<{ ok: boolean; value?: readonly string[]; error?: { code: string; message: string } }>>()
  const models = vi.fn<() => Promise<{ ok: boolean; value?: readonly CostReportModelRow[]; error?: { code: string; message: string } }>>()
  const remote = new TestRemote(ctx, { costReport: { report, workspaces, models } })
  const panelInfo = createSnapshotStore<PanelInfo>({ activePanelId: null })
  const selectPanel = vi.fn<ILayout['selectPanel']>((activePanelId) => { panelInfo.set({ activePanelId }) })
  ctx.provide('layout', { panelInfo, selectPanel, beginNavigation: () => new AbortController().signal,
    toggleSidebar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn() })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, report, workspaces, models, remote, selectPanel, panelInfo }
}

/** Declare the shell slots the plugin contributes into, removed on return. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-cost-report browser plugin', () => {
  it('declares only the services the page, its Remote reads, and the panel navigation use', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.costReport', 'layout'])
  })

  it('registers the sidebar entry and the main panel, then releases both on unload', async () => {
    expect(hostApply).not.toThrow()
    const b = await bench()
    const removeRoot = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('main')[0]!
    expect(entry.component).toBe(CostReportPage)
    expect(entry.options).toMatchObject({ key: PANEL_ID })
    expect(entry.locale).toBe(NS)
    // The panel store starts with an open range and no toggles.
    assert(entry.store && 'create' in entry.store)
    expect(entry.store.create().getSnapshot()).toEqual({ fromDay: '', toDay: '', cwd: null, model: null })
    const icon = b.slots.entries('sidebar.panellist')[0]!
    expect(icon.component).toBe(CostReportPanelIcon)
    expect(icon.options).toMatchObject({ id: PANEL_ID, order: 1 })
    expect(icon.locale).toBe(NS)
    expect(resolveSlotLabel(icon.options.label)).toBe('费用')
    b.locale.setLocale('en')
    expect(resolveSlotLabel(icon.options.label)).toBe('Costs')
    // The panel navigation service exists while the registration does and
    // opens the panel through the layout controller.
    const navigation = b.ctx.get('costReportNavigation')
    assert(navigation !== undefined)
    navigation.open()
    expect(b.selectPanel).toHaveBeenCalledWith(PANEL_ID)
    await fiber.dispose()
    expect(b.ctx.get('costReportNavigation')).toBeUndefined()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    removeRoot()
  })

  it('renders the sidebar glyph at the requested size', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const glyph = renderToStaticMarkup(createElement(CostReportPanelIcon, {
      size: 18, active: false, usePanelInfo: unusedStandardHook,
      useSessions: unusedStandardHook, useSessionStatus: unusedStandardHook,
      useSessionRetainInfo: unusedStandardHook, useWorkspaces: unusedStandardHook,
      useResource: unusedStandardHook,
    }))
    expect(glyph).toContain('width="18"')
    const view = render(createElement(CostReportPanelIcon, {
      size: 18, active: false, usePanelInfo: unusedStandardHook,
      useSessions: unusedStandardHook, useSessionStatus: unusedStandardHook,
      useSessionRetainInfo: unusedStandardHook, useWorkspaces: unusedStandardHook,
      useResource: unusedStandardHook,
    }))
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('18')
    view.unmount()
    await fiber.dispose()
  })

  it('reads the ledger buckets and catalogs through the injected Remote face', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    b.report.mockResolvedValueOnce({ ok: true, value: DAY_ROW })
    b.workspaces.mockResolvedValueOnce({ ok: true, value: ['/w1'] })
    b.models.mockResolvedValueOnce({ ok: true, value: [{ provider: 'openrouter', model: 'openai/gpt-4o' }] })
    const injected: object = b.slots.entries('main')[0]!.inject!()
    const face = injected as CostReportInjected
    const filter: CostReportFilter = { cwd: '/w1' }
    await expect(face.report('day' as CostReportGroup, filter)).resolves.toEqual(DAY_ROW)
    expect(b.report).toHaveBeenCalledWith({ group: 'day', filter })
    await expect(face.workspaces()).resolves.toEqual(['/w1'])
    await expect(face.models()).resolves.toEqual([{ provider: 'openrouter', model: 'openai/gpt-4o' }])
    await fiber.dispose()
  })

  it('translates a failed Remote read into a throwing face call', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    b.report.mockResolvedValueOnce({ ok: false, error: { code: 'costReport/unavailable', message: 'cost meter service is absent' } })
    b.workspaces.mockResolvedValueOnce({ ok: false, error: { code: 'costReport/unavailable', message: 'cost meter service is absent' } })
    b.models.mockResolvedValueOnce({ ok: false, error: { code: 'costReport/unavailable', message: 'cost meter service is absent' } })
    const injected: object = b.slots.entries('main')[0]!.inject!()
    const face = injected as CostReportInjected
    await expect(face.report('day', {})).rejects.toThrow('costReport.report failed: costReport/unavailable: cost meter service is absent')
    await expect(face.workspaces()).rejects.toThrow('costReport.workspaces failed: costReport/unavailable: cost meter service is absent')
    await expect(face.models()).rejects.toThrow('costReport.models failed: costReport/unavailable: cost meter service is absent')
    await fiber.dispose()
  })

  it('registers the panel dictionary in both languages', async () => {
    // The dictionary lands as `{ zh, en }` under the plugin's namespace.
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(en.panel).toBe('Costs')
    expect(zh.panel).toBe('费用')
  })
})