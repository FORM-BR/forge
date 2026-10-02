/**
 * Agent-facing read of the MCP server panel data: the same secret-free
 * snapshot the Settings panel shows, for an assistant that helps configure,
 * diagnose, or connect MCP servers.
 *
 * @module @deepseek-ai/dsh-api-mcp-status/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { McpStatusSnapshot } from './types.ts'

/**
 * The tool module and the service bundle are separate module instances at runtime,
 * so the registry is recognised by its published read rather than by class identity.
 */
function readsSnapshot(service: object): service is { list(): McpStatusSnapshot } {
  return 'list' in service && typeof (service).list === 'function'
}

/** Required services for the status tool. */
export const inject = ['tools', 'mcpServerStatus']

/**
 * Register the read-only `mcp_servers` tool.
 * @param ctx - Agent-scoped tool registration context.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mcp_servers',
    description: 'List the MCP servers configured for this profile with what the Settings > MCP servers panel shows: connection state (connecting, connected, error, disabled), transport, tool count, the last error with secrets removed, retry/halt reasons, and for each definition found in a patch file its source (profile or home) plus an editable view in which every secret value is hidden (environment variables and headers appear by name only, credential-like arguments and URL credentials are replaced by bullets). `management` says whether the profile file can be edited and where the files are. Read-only; call it before changing the configuration and again afterwards to confirm the effect.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute() {
      const service = ctx.mcpServerStatus
      if (!readsSnapshot(service)) {
        throw new Error('MCP status is not available in this deployment')
      }
      return Promise.resolve(JSON.stringify(service.list(), null, 2))
    },
    presentCall: () => ({ card: 'generic', title: 'List MCP servers', kind: 'read', rawInput: {} }),
  }))
}
