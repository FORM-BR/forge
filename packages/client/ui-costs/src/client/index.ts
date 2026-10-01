/** Register the catalog-priced API cost panel with the right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { CostsDayRow, CostsModelRow } from '@deepseek-ai/dsh-api-costs-controller/types'
import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated `costs` Remote namespace into the Client face
// so `ctx.remote.costs` carries its namespaced verbs and wire types.
import type {} from '@deepseek-ai/dsh-api-costs-controller/remote'
import { CostsTab } from './CostsTab.tsx'
import { CostsTitle } from './CostsTitle.tsx'
import type { CostsInjected } from './face.ts'
import { en, zh } from './locales.ts'

/** Services needed by the costs panel's sidebar seats. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.costs']

/** The localized costs panel id, used as both tab and seat keys. */
export const UI_COSTS_ID = '@deepseek-ai/dsh-client-ui-costs'

/** Dictionary namespace owned by this plugin. */
export const NS = 'sidebarCosts'

/**
 * Register the costs tab type, its guide entry and the panel's two seats.
 * @param ctx - Client root Context with sidebar, slots and the Remote gate.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  const injected = (): CostsInjected => ({
    byDay: async (): Promise<CostsDayRow[]> => {
      const result = await ctx.remote.costs.byDay()
      if (!result.ok) throw new Error(`costs.byDay failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    byModel: async (): Promise<CostsModelRow[]> => {
      const result = await ctx.remote.costs.byModel()
      if (!result.ok) throw new Error(`costs.byModel failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-costs.copy')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: UI_COSTS_ID, kind: 'costs', priority: 'builtin', title: () => t('title'),
    guide: [{ id: 'open', order: 25, title: () => t('title'), description: () => t('description'), icon: IconDatabaseOutlineRegular }],
  }), 'ui-sidebar-costs.type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: UI_COSTS_ID, locale: NS, inject: injected }, CostsTab,
  )), 'ui-sidebar-costs.body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: UI_COSTS_ID, locale: NS, inject: injected }, CostsTitle,
  )), 'ui-sidebar-costs.title')
}

export type { CostsTabProps } from './CostsTab.tsx'
export type { CostsInjected } from './face.ts'
