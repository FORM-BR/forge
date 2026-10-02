/**
 * Host Remote owner for the connection status of configured MCP servers: the
 * live status each `dsh-mcp-client` plugin reports, joined with the Loader's
 * mcp-client entries that are disabled, still waiting to start, or failed to
 * load, over the generated `mcpStatus` namespace. Reads are projections of
 * current state with no cache and no secrets.
 *
 * @module @deepseek-ai/dsh-api-mcp-status
 */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { McpServerStatus, McpServerStatusRegistry, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { McpServerSummary, McpStatusSnapshot } from './types.ts'

export type * from './types.ts'

/** Loader module specifier of the MCP client plugin. */
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  FAILED: 3 as FiberState.FAILED,
} as const

type Transport = McpServerSummary['transport']

/**
 * Host service backing the generated `ctx.remote.mcpStatus` namespace. It is
 * also the registry the `dsh-mcp-client` plugins report into, so a deployment
 * without it runs MCP servers unchanged and simply shows no panel data.
 */
export class McpStatusService extends TypertRemoteService implements McpServerStatusRegistry {
  private readonly sources = new Set<McpServerStatusSource>()

  /**
   * @param ctx - Host context where the MCP client plugins and the Loader live.
   */
  constructor(ctx: Context) {
    super(ctx, 'mcpServerStatus', { namespace: 'mcpStatus' })
  }

  /**
   * Add one MCP server connection's status owner for the lifetime of the calling plugin.
   * @param source - the connection's status owner.
   * @returns the disposer that removes exactly this registration.
   */
  register(source: McpServerStatusSource): () => void {
    // oxlint-disable-next-line typescript/no-misused-promises -- removal is synchronous; Cordis retains any pending fiber disposal
    return this.ctx.effect(() => {
      this.sources.add(source)
      return () => { this.sources.delete(source) }
    }, 'mcpStatus.register')
  }

  /**
   * Summarize every MCP server: connected, connecting, failed, and disabled.
   * @returns servers ordered by name; empty when no mcp-client entry is configured.
   */
  @Remote
  list(): McpStatusSnapshot {
    const live = [...this.sources].map(source => source.status())
    const liveNames = new Set(live.map(status => status.serverName))
    const servers = [
      ...live.map(liveSummary),
      ...this.loaderOnlySummaries(liveNames),
    ].sort((a, b) => a.serverName.localeCompare(b.serverName))
    const seen = new Map<string, number>()
    return {
      servers: servers.map((server) => {
        const count = seen.get(server.key) ?? 0
        seen.set(server.key, count + 1)
        return count === 0 ? server : { ...server, key: `${server.key}#${String(count)}` }
      }),
    }
  }

  /** Loader entries of the MCP client that have no live connection to report. */
  private loaderOnlySummaries(liveNames: ReadonlySet<string>): McpServerSummary[] {
    const loader = this.ctx.get('loader')
    if (loader === undefined) return []
    const summaries: McpServerSummary[] = []
    for (const entry of loader.entries()) {
      if (entry.options.name !== MCP_CLIENT_MODULE || entry.options.group) continue
      const identity = entryIdentity(entry.options.config, entry.id)
      const base = { key: identity.serverName, ...identity, toolCount: 0 }
      if (entry.disabled) {
        summaries.push({ ...base, state: 'disabled' })
      } else if (entry.fiber === undefined || entry.fiber.state === FIBER_STATE.FAILED) {
        // No root Fiber on an enabled entry means its module could not be imported.
        summaries.push({ ...base, state: 'error', halted: 'load-failed' })
      } else if (entry.fiber.state === FIBER_STATE.PENDING && !liveNames.has(identity.serverName)) {
        summaries.push({ ...base, state: 'connecting' })
      }
    }
    return summaries
  }
}

export default McpStatusService

/** Project one live connection snapshot onto the wire summary. */
function liveSummary(status: McpServerStatus): McpServerSummary {
  return {
    key: status.serverName,
    serverName: status.serverName,
    transport: status.transport,
    ...status.host === undefined ? {} : { host: status.host },
    state: status.phase,
    toolCount: status.toolCount,
    ...status.error === undefined ? {} : { error: status.error },
    ...status.retry === undefined ? {} : { retry: { ...status.retry } },
    ...status.halted === undefined ? {} : { halted: status.halted },
  }
}

/**
 * Read the display identity of a configured entry without evaluating anything:
 * only literal `serverName`, `transport`, and the host of a literal `url` count;
 * a `!!js` expression or any other field is never looked at.
 */
function entryIdentity(config: unknown, entryId: string): { serverName: string; transport: Transport; host?: string } {
  const fields = config !== null && typeof config === 'object' ? config as Record<string, unknown> : {}
  const name = fields['serverName']
  const serverName = typeof name === 'string' && name !== '' ? name : entryId
  const kind = fields['transport']
  const transport = kind === 'stdio' || kind === 'streamable-http' ? kind : null
  const url = fields['url']
  const host = transport === 'streamable-http' && typeof url === 'string' ? hostOf(url) : undefined
  return { serverName, transport, ...host === undefined ? {} : { host } }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch (_error) {
    return undefined
  }
}
