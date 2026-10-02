/**
 * Browser-safe wire types of the generated `mcpStatus` Remote namespace: a
 * secret-free summary of every configured MCP server, and the write-only draft
 * the panel sends back to add or change one. No type here returns an `env` or
 * header value, a secret-looking argument, or URL credentials/query values;
 * those only travel client-to-host, and are masked on the way back.
 *
 * @module @deepseek-ai/dsh-api-mcp-status/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The profile cannot be edited from the panel (safe mode, or no profile patch is mounted). */
    'mcpStatus/read-only': { readonly reason: 'safe-mode' | 'no-profile' | 'defined-elsewhere' }
    /** The submitted server definition is not valid; `field` names the offending form field. */
    'mcpStatus/invalid': { readonly field: string }
    /** The targeted server entry no longer exists in the profile patch. */
    'mcpStatus/not-found': {}
    /** The configuration was written but could not be applied; the file was restored. */
    'mcpStatus/apply-failed': {}
  }
}

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
  /**
   * Which patch file holds the definition. `profile` can be edited from the panel; `home` is shown
   * read-only. Absent when it comes from a bundle or command-line layer.
   */
  readonly source?: McpServerSource
  /** Editable view of the definition; absent when the definition is not a profile row. */
  readonly config?: McpServerConfigView
  /** Set when the saved definition has not taken effect yet and needs a restart. */
  readonly pendingRestart?: boolean
}

/** Patch file a server definition comes from. */
export type McpServerSource = 'profile' | 'home'

/** One command-line argument as shown back to the editor. */
export interface McpArgView {
  /** Argument text; the value of a secret-looking argument is replaced by bullets. */
  readonly text: string
  /** True when `text` hides a secret value; sending the argument back as `keep` retains it. */
  readonly masked: boolean
}

/** Definition of one server with every secret value hidden. */
export interface McpServerConfigView {
  /** Loader entry id of the definition; the handle for every write. */
  readonly id: string
  /** Whether the entry is switched off in the file. */
  readonly disabled: boolean
  /** False when a field holds an expression the form cannot represent; the entry can still be toggled or removed. */
  readonly editable: boolean
  readonly command?: string
  readonly args?: readonly McpArgView[]
  /** URL with credentials and query values replaced by bullets. */
  readonly url?: string
  /** True when the URL carries credentials or query values (so editing it means retyping it). */
  readonly urlMasked?: boolean
  /** Names of the configured environment variables; values never leave the Host. */
  readonly envKeys?: readonly string[]
  /** Names of the configured request headers; values never leave the Host. */
  readonly headerKeys?: readonly string[]
}

/** One argument of a draft: new text, or the unchanged original argument at `keep`. */
export interface McpArgDraft {
  readonly value?: string
  readonly keep?: number
}

/** The form the panel submits to create or replace one server definition. */
export interface McpServerDraft {
  /** Local tool namespace (`[A-Za-z0-9_-]{1,32}`). */
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  /** stdio: executable. */
  readonly command?: string
  /** stdio: arguments in order. */
  readonly args?: readonly McpArgDraft[]
  /** streamable-http: endpoint; `null`/absent keeps the stored URL when editing. */
  readonly url?: string | null
  /** stdio: variables to keep or set. A `null` value keeps the stored value; omitted keys are removed. */
  readonly env?: Record<string, string | null>
  /** streamable-http: headers to keep or set, same rules as `env`. */
  readonly headers?: Record<string, string | null>
}

/** Whether and how the panel may edit the profile configuration. */
export interface McpManagement {
  /** True when add, edit, toggle, and remove can be applied. */
  readonly writable: boolean
  readonly readOnlyReason?: 'safe-mode' | 'no-profile'
  /** Display path of the profile patch new servers are written to. */
  readonly profileFile?: string
  /** Display path of the user-wide patch some servers may come from. */
  readonly homeFile?: string
}

/** What a write did. */
export interface McpWriteResult {
  /** `applied` is live; `pending` is still starting; `restart-required` takes effect after a restart. */
  readonly outcome: 'applied' | 'pending' | 'restart-required'
  /** Entry id written. */
  readonly id: string
}

/** Point-in-time answer of `mcpStatus/list`. */
export interface McpStatusSnapshot {
  /** Servers ordered by `serverName`. */
  readonly servers: readonly McpServerSummary[]
  readonly management: McpManagement
}
