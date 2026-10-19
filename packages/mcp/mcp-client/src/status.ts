/**
 * Connection status reporting: a secret-free snapshot of one MCP server's
 * connection that a status consumer (for example the Settings panel Remote)
 * reads on demand. The snapshot never carries `env`, `headers`, `args`, a
 * command line, or a URL beyond its host.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional registry that collects the status of every connected MCP server plugin. */
    mcpServerStatus: McpServerStatusRegistry
  }
}

/** Where one MCP server connection currently stands. */
export type McpConnectionPhase = 'connecting' | 'connected' | 'error'

/** Why a failed connection will not be attempted again without a reload. */
export type McpConnectionHalt = 'reconnect-disabled' | 'attempts-exhausted' | 'transport-unconfirmed'

/** Secret-free status of one configured MCP server. */
export interface McpServerStatus {
  /** Local namespace of the server's tools (`mcp__<serverName>__<tool>`). */
  serverName: string
  /** Transport the server is configured with. */
  transport: Config['transport']
  /** `host[:port]` of the Streamable HTTP endpoint; absent for stdio. */
  host?: string
  /** `connected` after the initial tool synchronization, `connecting` while an attempt runs, otherwise `error`. */
  phase: McpConnectionPhase
  /** Tools currently registered for this server. */
  toolCount: number
  /** Most recent failure with configured secrets, URL paths and queries removed, bounded in length. */
  error?: string
  /** Consecutive failed attempts in the current outage, while another attempt is scheduled or running. */
  retry?: { attempt: number; maxAttempts: number }
  /** Set when no further reconnect attempt will run until the plugin reloads. */
  halted?: McpConnectionHalt
}

/** One MCP server connection's status owner. */
export interface McpServerStatusSource {
  /**
   * Read the connection's current state.
   * @returns a fresh snapshot; it never throws.
   */
  status(): McpServerStatus
}

/** Collects the status of every live MCP server plugin in its scope. */
export interface McpServerStatusRegistry {
  /**
   * Add one server's status owner for the lifetime of the calling plugin.
   * @param source - the connection's status owner.
   * @returns the disposer that removes exactly this registration.
   */
  register(source: McpServerStatusSource): () => void
}

/**
 * Publish a server's status to the registry while one is composed.
 * @param ctx - server plugin's registration scope and effect owner.
 * @param source - connection-owned status snapshot.
 */
export function registerServerStatus(ctx: Context, source: McpServerStatusSource): void {
  ctx.inject(['mcpServerStatus'], (inner) => {
    inner.mcpServerStatus.register(source)
  })
}

/** Longest error message reported to a status consumer. */
const MAX_ERROR_CHARS = 240

/** Shorter values would blank harmless substrings of an error message. */
const MIN_SECRET_LENGTH = 4

const SENSITIVE_ARG = /token|secret|passw|api[-_]?key|auth|credential/i
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi

/** Values in the config that must never reach a status consumer. */
function configSecrets(config: Config): string[] {
  const values: string[] = []
  if (config.transport === 'stdio') {
    values.push(...Object.values(config.env))
    config.args.forEach((arg, index) => {
      if (!SENSITIVE_ARG.test(arg)) return
      const assigned = arg.indexOf('=')
      values.push(assigned === -1 ? config.args[index + 1] ?? '' : arg.slice(assigned + 1))
    })
  } else {
    values.push(...Object.values(config.headers))
    const url = parseUrl(config.url)
    if (url !== undefined) values.push(url.username, url.password, ...url.searchParams.values())
  }
  return values.filter(value => value.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length)
}

function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch (_error) {
    return undefined
  }
}

/**
 * Host part of a Streamable HTTP endpoint.
 * @param config - the server configuration.
 * @returns `host[:port]` for Streamable HTTP, or undefined for stdio or an unparsable URL.
 */
export function endpointHost(config: Config): string | undefined {
  return config.transport === 'stdio' ? undefined : parseUrl(config.url)?.host
}

/**
 * Turn a connection failure into a short message safe to show in a UI.
 * Configured secret values, URL userinfo, paths and queries, and
 * `Bearer`/`Basic` credentials are replaced; whitespace collapses and the
 * result is cut at {@link MAX_ERROR_CHARS} characters.
 * @param error - the thrown value.
 * @param config - the server configuration whose secret values are masked.
 * @returns a single-line message.
 */
export function describeStatusError(error: unknown, config: Config): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of configSecrets(config)) message = message.split(secret).join('***')
  message = message
    .replace(URL_IN_TEXT, (match) => {
      const url = parseUrl(match)
      return url === undefined ? '[url]' : `${url.protocol}//${url.host}`
    })
    .replace(AUTH_SCHEME, '$1 ***')
    .replace(/\s+/g, ' ')
    .trim()
  if (message === '') return 'Unknown error'
  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS - 1)}…` : message
}
