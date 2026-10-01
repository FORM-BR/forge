/**
 * Cross-session cost report, browser half: the **Costs** entry of the sidebar
 * and the main panel it opens. The panel reads ledger aggregates, workspace
 * roots, and model routes through the `costReport` Remote — projections of the
 * SQLite ledger the Host's cost meter maintains — and shows them as filtered
 * summary cards, a daily series, and a session drill-down.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the renderer's ctx.slots injection and `main` slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated `costReport` Remote namespace into the Client
// face so `ctx.remote.costReport` carries its verbs and wire types.
import type {} from '@deepseek-ai/dsh-api-cost-report/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CostReportPage } from './CostReportPage.tsx'
import { CostReportPanelIcon } from './CostReportPanelIcon.tsx'
import { createCostReportStore } from './cost-report-store.ts'
import type { CostReportInjected } from './face.ts'
import { en, zh } from './locales.ts'

/** Services needed by the panel registration and its Remote reads. */
export const inject = ['slots', 'locale', 'remote', 'remote.costReport', 'layout']

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'cost-report' as MainPanelId

/** Dictionary namespace owned by this plugin. */
export const NS = 'costReport'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-plugin navigation into the Costs report panel. */
    costReportNavigation: {
      /** Open the Costs report panel without changing the current Session. */
      open(): void
    }
  }
}

/**
 * Register the Costs sidebar entry and its main panel. The panel is a global
 * panel belonging to no Session; the store keeps its filters across remounts.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-cost-report.copy')
  const t = ctx.locale.bind(NS)
  const face = (): CostReportInjected => ({
    report: async (group, filter) => {
      const result = await ctx.remote.costReport.report({ group, filter })
      if (!result.ok) throw new Error(`costReport.report failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    workspaces: async () => {
      const result = await ctx.remote.costReport.workspaces()
      if (!result.ok) throw new Error(`costReport.workspaces failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    models: async () => {
      const result = await ctx.remote.costReport.models()
      if (!result.ok) throw new Error(`costReport.models failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    usdBrlRates: async (fromDay, toDay) => {
      const result = await ctx.remote.costReport.usdBrlRates({ fromDay, toDay })
      if (!result.ok) throw new Error(`costReport.usdBrlRates failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  })
  ctx.slots.inject('main', function* () {
    const handle = createCostReportStore(), instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      store,
      inject: face,
      children: {},
    }, CostReportPage)
    // The dock's cost pill opens this panel through the service; it lives only
    // while the panel registration does, so excluding the plugin removes the
    // shortcut everywhere.
    const disposeNavigation = ctx.reflect.provide('costReportNavigation', {
      open: () => ctx.layout.selectPanel(PANEL_ID),
    })
    yield () => { void disposeNavigation() }
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 1,
    label: () => t('panel'),
    locale: NS,
  }, CostReportPanelIcon))
}

export type { CostReportPageProps } from './CostReportPage.tsx'
export type { CostReportInjected } from './face.ts'
