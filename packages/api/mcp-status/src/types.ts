/**
 * Browser-safe wire types of the generated `mcpStatus` Remote namespace: a
 * secret-free summary of every configured MCP server. No type here can carry
 * `env`, `headers`, `args`, a command line, or a URL beyond its host.
 *
 * @module @deepseek-ai/dsh-api-mcp-status/types
 */

/** Where one configured MCP server stands. */
export type McpServerState = 'connecting' | 'connected' | 'error' | 'disabled'

/** Why a server in the `error` state will not be tried again without a reload. */
export type McpServerHalt =
  | 'reconnect-disabled'
  | 'attempts-exhausted'
  | 'transport-unconfirmed'
  | 'load-failed'

/** One configured MCP server as the Host sees it right now. */
export interface McpServerSummary {
  /** Unique list key; two servers sharing a `serverName` in different scopes get distinct keys. */
  readonly key: string
  /** Local namespace of the server's tools; the Loader entry id when the config has no literal name. */
  readonly serverName: string
  /** Configured transport, or null when the config does not state it literally. */
  readonly transport: 'stdio' | 'streamable-http' | null
  /** `host[:port]` of a Streamable HTTP endpoint; never a path, query, or credentials. */
  readonly host?: string
  readonly state: McpServerState
  /** Tools currently registered for the server; 0 when it never connected or is disabled. */
  readonly toolCount: number
  /** Most recent failure, with configured secrets and URL details already removed. */
  readonly error?: string
  /** Consecutive failed attempts in the current outage while another attempt is scheduled or running. */
  readonly retry?: { readonly attempt: number; readonly maxAttempts: number }
  readonly halted?: McpServerHalt
}

/** Point-in-time answer of `mcpStatus/list`. */
export interface McpStatusSnapshot {
  /** Servers ordered by `serverName`. */
  readonly servers: readonly McpServerSummary[]
}
