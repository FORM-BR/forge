/** Registration of the Agent Map right-Sidebar tab type and its two seats. */
import type { Context } from '@deepseek-ai/cordis'
import { IconWorkspaceTreeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from '../locales.ts'
import { NS as SUBAGENT_NS } from '../locales.ts'
import { AgentMapTab, AgentMapTitle, type AgentMapInjected } from './AgentMapTab.tsx'

/** Stable implementation identity: the key of the tab body and title seats. */
export const AGENT_MAP_ID = '@deepseek-ai/dsh-client-ui-subagent/agent-map'

/** Page-type discriminator opened through `ctx.sidebarRight.openTab`. */
export const AGENT_MAP_KIND = 'agentmap'

/**
 * Register the Agent Map tab type, its guide entry and both Sidebar seats.
 * @param ctx - Client root carrying Sidebar tab registry and Slots.
 * @param t - subagent namespace translator for the type's static copy.
 * @param injected - navigation actions handed to the body.
 */
export function registerAgentMap(
  ctx: Context,
  t: TranslateNS<typeof NS>,
  injected: () => AgentMapInjected,
): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: AGENT_MAP_ID,
    kind: AGENT_MAP_KIND,
    priority: 'builtin',
    title: () => t('map.title'),
    guide: [{
      id: 'open',
      order: 26,
      title: () => t('map.title'),
      description: () => t('map.description'),
      icon: IconWorkspaceTreeOutlineRegular,
    }],
  } satisfies SidebarRightTabDefinition), 'ui-subagent: Agent Map type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: AGENT_MAP_ID,
    locale: SUBAGENT_NS,
    inject: injected,
  }, AgentMapTab)), 'ui-subagent: Agent Map body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: AGENT_MAP_ID,
    locale: SUBAGENT_NS,
    inject: injected,
  }, AgentMapTitle)), 'ui-subagent: Agent Map title')
}
