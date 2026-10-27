/** MCP server status and editing registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the optional `agentPresetLauncher` service merge; the button hides without it.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { fieldOf, McpActionError } from './actions.ts'
import { McpSettingsTab, type McpSettingsTabInjected } from './McpSettingsTab.tsx'
import { en, zh, type McpSettingsLocaleKey } from './locales.ts'

export type { McpSettingsTabInjected, McpSettingsTabProps } from './McpSettingsTab.tsx'
export type { McpSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP server status and editing copy. */
    'settings.mcp': McpSettingsLocaleKey
  }
}

/** Shipped agent preset that helps with MCP servers. */
const MCP_PRESET_ID = 'mcp'

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcp'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.mcpStatus']

/** Contribute the lazy MCP servers tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: McpSettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.mcpStatus.list()
    if (!result.ok) {
      throw new Error(`mcpStatus.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const failed = (error: { readonly code: string; readonly message: string; readonly details: object }): McpActionError =>
    new McpActionError(error.message, error.code, fieldOf(error.details))
  const save: McpSettingsTabInjected['save'] = async (draft, id) => {
    const result = await ctx.remote.mcpStatus.save(draft, id)
    if (!result.ok) throw failed(result.error)
    return result.value
  }
  const setEnabled: McpSettingsTabInjected['setEnabled'] = async (id, enabled) => {
    const result = await ctx.remote.mcpStatus.setEnabled(id, enabled)
    if (!result.ok) throw failed(result.error)
    return result.value
  }
  const remove: McpSettingsTabInjected['remove'] = async (id) => {
    const result = await ctx.remote.mcpStatus.removeServer(id)
    if (!result.ok) throw failed(result.error)
    return result.value
  }
  const openFile: McpSettingsTabInjected['openFile'] = async (which) => {
    const result = await ctx.remote.mcpStatus.openConfigFile(which)
    if (!result.ok) throw failed(result.error)
  }

  // The launcher lives with the conversation flow, so it is read per render rather than captured.
  const face = (): McpSettingsTabInjected => {
    const launcher = ctx.get('agentPresetLauncher')
    return {
      list, save, setEnabled, remove, openFile,
      ...launcher === undefined ? {} : {
        askAgent: { available: launcher.available(), start: () => { launcher.start(MCP_PRESET_ID) } },
      },
    }
  }

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'mcp',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: face,
  }, McpSettingsTab))
}
