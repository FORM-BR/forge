/**
 * Host Remote owner for the configured MCP servers: the live status each
 * `dsh-mcp-client` plugin reports, joined with the Loader's mcp-client entries
 * that are disabled, still waiting to start, or failed to load, plus the
 * writes that add, edit, toggle, and remove servers in the profile patch, over
 * the generated `mcpStatus` namespace. Reads are projections of current state
 * with no cache and no secret values; writes accept secrets one way only.
 *
 * @module @deepseek-ai/dsh-api-mcp-status
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-app-boot'
import type { DocumentEditOutcome } from '@deepseek-ai/dsh-config-editor'
import type { McpServerStatus, McpServerStatusRegistry, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'
import { openNativeTextFile } from '@deepseek-ai/dsh-native-command'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { maskArgs, maskUrl, scrubSecrets } from './mask.ts'
import {
  addMcpRow, MCP_CLIENT_MODULE, McpPatchError, readMcpRows, removeMcpRow, setMcpRowEnabled, updateMcpRow,
} from './patch-file.ts'
import type { McpRow } from './patch-file.ts'
import type {
  McpManagement, McpServerConfigView, McpServerDraft, McpServerSource, McpServerSummary, McpStatusSnapshot, McpWriteResult,
} from './types.ts'

export type * from './types.ts'

/** File name of a profile or user-wide patch. */
const PATCH_FILENAME = 'cordis.patch.yml'

/** Longest error text relayed to the panel. */
const MAX_APPLY_ERROR_CHARS = 300

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  FAILED: 3 as FiberState.FAILED,
} as const

type Transport = McpServerSummary['transport']

interface Definition {
  readonly row: McpRow
  readonly source: McpServerSource
}

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
   * Summarize every MCP server: connected, connecting, failed, and disabled,
   * with the secret-free definition of those found in a patch file.
   * @returns servers ordered by name, and whether the panel may edit the profile.
   */
  @Remote
  list(): McpStatusSnapshot {
    const live = [...this.sources].map(source => source.status())
    const liveNames = new Set(live.map(status => status.serverName))
    const definitions = this.definitions()
    const unused = new Set(definitions)
    const claim = (serverName: string): Definition | undefined => {
      const found = definitions.find(definition => unused.has(definition) && definition.row.serverName === serverName)
      if (found !== undefined) unused.delete(found)
      return found
    }
    const joined: McpServerSummary[] = [
      ...live.map(liveSummary),
      ...this.loaderOnlySummaries(liveNames),
    ].map((summary) => {
      const definition = claim(summary.serverName)
      return definition === undefined ? summary : withDefinition(summary, definition)
    })
    // A saved definition the Loader has not mounted yet (a restart is pending) still belongs in the list.
    for (const definition of unused) joined.push(withDefinition(pendingSummary(definition.row), definition, true))
    const servers = joined.sort((a, b) => a.serverName.localeCompare(b.serverName))
    const seen = new Map<string, number>()
    return {
      servers: servers.map((server) => {
        const count = seen.get(server.key) ?? 0
        seen.set(server.key, count + 1)
        return count === 0 ? server : { ...server, key: `${server.key}#${String(count)}` }
      }),
      management: this.management(),
    }
  }

  /**
   * Add a server to the profile configuration, or replace the form-owned fields of one already there.
   * Secrets travel only in this direction: stored values are kept when the draft says so.
   * @param draft - the submitted definition.
   * @param id - Loader entry id of the server being edited; absent to add a new one.
   * @returns the entry id written and whether the change is live, still starting, or needs a restart.
   * @throws RemoteError when the profile is read-only, the draft is invalid, or the Loader rejects the result.
   */
  @Remote
  async save(draft: McpServerDraft, id: string | undefined): Promise<McpWriteResult> {
    const known = this.knownNames()
    const own = id === undefined ? undefined : this.definitions().find(entry => entry.row.id === id)
    if (known.names.has(draft.name) && own?.row.serverName !== draft.name) {
      throw new RemoteError('mcpStatus/invalid', 'another MCP server already uses this name', { field: 'name' })
    }
    const entryId = id ?? uniqueId(`mcp-${draft.name}`, known.ids)
    const outcome = await this.write(
      text => id === undefined ? addMcpRow(text, draft, entryId) : updateMcpRow(text, id, draft),
      [entryId], draftSecrets(draft), id,
    )
    return { outcome, id: entryId }
  }

  /**
   * Switch one profile server on or off.
   * @param id - Loader entry id of the server.
   * @param enabled - the wanted state.
   * @returns the entry id and how the change was applied.
   * @throws RemoteError when the profile is read-only, the server is not in it, or the Loader rejects the result.
   */
  @Remote
  async setEnabled(id: string, enabled: boolean): Promise<McpWriteResult> {
    const outcome = await this.write(text => setMcpRowEnabled(text, id, enabled), enabled ? [id] : [], [], id)
    return { outcome, id }
  }

  /**
   * Delete one profile server.
   * @param id - Loader entry id of the server.
   * @returns the entry id and how the change was applied.
   * @throws RemoteError when the profile is read-only, the server is not in it, or the Loader rejects the result.
   */
  @Remote
  async removeServer(id: string): Promise<McpWriteResult> {
    const outcome = await this.write(text => removeMcpRow(text, id), [], [], id)
    return { outcome, id }
  }

  /**
   * Open a patch file in the native text editor.
   * @param which - the profile patch, or the user-wide one when it exists.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the file.
   * @throws RemoteError when the file is unavailable or cannot be opened.
   */
  @Remote
  async openConfigFile(which: 'profile' | 'home', signal: AbortSignal): Promise<{ opened: boolean }> {
    const files = this.files()
    const path = which === 'home' ? files?.home : files?.profile
    if (path === undefined || (which === 'home' && readText(path) === undefined)) {
      throw new RemoteError('mcpStatus/not-found', 'that configuration file does not exist', {})
    }
    try {
      await openNativeTextFile(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `could not open the configuration file: ${error instanceof Error ? error.message : String(error)}`, {}, { cause: error })
    }
  }

  /** Paths of the profile patch and the user-wide patch, when a profile is mounted. */
  private files(): { profile: string; home: string } | undefined {
    const profile = this.ctx.get('profileContext')
    if (profile === undefined) return undefined
    return { profile: profile.patchPath, home: join(profile.home, PATCH_FILENAME) }
  }

  private management(): McpManagement {
    const profile = this.ctx.get('profileContext')
    const files = this.files()
    if (profile === undefined || files === undefined || this.ctx.get('configEditor') === undefined) {
      return { writable: false, readOnlyReason: 'no-profile' }
    }
    return {
      writable: profile.safeMode !== true,
      ...profile.safeMode === true ? { readOnlyReason: 'safe-mode' as const } : {},
      profileFile: displayPath(files.profile),
      homeFile: displayPath(files.home),
    }
  }

  /** MCP client rows of the profile patch and the user-wide patch; unreadable files contribute nothing. */
  private definitions(): Definition[] {
    const files = this.files()
    if (files === undefined) return []
    const found: Definition[] = []
    for (const [source, path] of [['profile', files.profile], ['home', files.home]] as const) {
      const text = readText(path)
      if (text === undefined) continue
      try {
        for (const row of readMcpRows(text)) found.push({ row, source })
      } catch (_error) {
        // A file the panel cannot parse is the Loader's to report; it just offers no rows here.
      }
    }
    return found
  }

  /** Entry ids and server names already taken in the files, in the Loader, and by live connections. */
  private knownNames(): { ids: Set<string>; names: Set<string> } {
    const definitions = this.definitions()
    const ids = new Set<string>(definitions.map(({ row }) => row.id))
    const names = new Set<string>(definitions.map(({ row }) => row.serverName))
    for (const source of this.sources) names.add(source.status().serverName)
    const loader = this.ctx.get('loader')
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        ids.add(entry.options.id)
        if (entry.options.name === MCP_CLIENT_MODULE) names.add(entryIdentity(entry.options.config, entry.id).serverName)
      }
    }
    return { ids, names }
  }

  /** Apply one text edit to the profile patch through the config editor. */
  private async write(
    change: (text: string) => string,
    requiredIds: readonly string[],
    secrets: readonly string[],
    targetId: string | undefined,
  ): Promise<DocumentEditOutcome> {
    const profile = this.ctx.get('profileContext')
    const editor = this.ctx.get('configEditor')
    if (profile === undefined || editor === undefined) {
      throw new RemoteError('mcpStatus/read-only', 'no profile configuration is mounted', { reason: 'no-profile' })
    }
    if (profile.safeMode === true) {
      throw new RemoteError('mcpStatus/read-only', 'safe mode does not allow editing the configuration', { reason: 'safe-mode' })
    }
    if (targetId !== undefined) {
      const rows = this.definitions().filter(({ row }) => row.id === targetId)
      if (rows.length > 0 && !rows.some(({ source }) => source === 'profile')) {
        throw new RemoteError('mcpStatus/read-only', 'this server is defined outside the profile configuration; edit that file instead', { reason: 'defined-elsewhere' })
      }
    }
    try {
      return await editor.editDocument(change, { requiredIds })
    } catch (error: unknown) {
      if (error instanceof McpPatchError) {
        throw error.kind === 'not-found'
          ? new RemoteError('mcpStatus/not-found', error.message, {})
          : new RemoteError('mcpStatus/invalid', error.message, { field: error.field })
      }
      const message = error instanceof Error ? error.message : String(error)
      const cleaned = scrubSecrets(message, secrets).replace(/\s+/g, ' ').trim()
      throw new RemoteError('mcpStatus/apply-failed', cleaned.length > MAX_APPLY_ERROR_CHARS ? `${cleaned.slice(0, MAX_APPLY_ERROR_CHARS - 1)}…` : cleaned, {})
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

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (_error) {
    return undefined
  }
}

/** `~`-relative form of a path under the user's home directory. */
function displayPath(path: string): string {
  const home = homedir()
  return path.toLowerCase().startsWith(home.toLowerCase()) ? `~${path.slice(home.length).replace(/\\/g, '/')}` : path
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n)}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Values of a draft that must never be quoted back in an error. */
function draftSecrets(draft: McpServerDraft): string[] {
  return [
    ...Object.values(draft.env ?? {}),
    ...Object.values(draft.headers ?? {}),
    ...(draft.args ?? []).map(arg => arg.value),
    draft.url,
  ].filter((value): value is string => typeof value === 'string' && value !== '')
}

function configView(row: McpRow): McpServerConfigView {
  const url = row.url === undefined ? undefined : maskUrl(row.url)
  const shown = maskArgs(row.args.map(arg => arg.expression ? '' : arg.text))
  return {
    id: row.id,
    disabled: row.disabled,
    editable: row.editable,
    ...row.command === undefined ? {} : { command: row.command },
    ...row.transport === 'stdio'
      ? { args: shown.map((view, index) => row.args[index]?.expression === true ? { text: '(expression)', masked: true } : view) }
      : {},
    ...url === undefined ? {} : { url: url.text, urlMasked: url.masked },
    ...row.transport === 'stdio' ? { envKeys: row.envKeys } : {},
    ...row.transport === 'streamable-http' ? { headerKeys: row.headerKeys } : {},
  }
}

function withDefinition(summary: McpServerSummary, definition: Definition, pendingRestart = false): McpServerSummary {
  return {
    ...summary,
    source: definition.source,
    config: configView(definition.row),
    ...pendingRestart ? { pendingRestart: true } : {},
  }
}

/** Summary of a saved definition no Loader entry reflects yet. */
function pendingSummary(row: McpRow): McpServerSummary {
  const host = row.transport === 'streamable-http' && row.url !== undefined ? hostOf(row.url) : undefined
  return {
    key: row.serverName,
    serverName: row.serverName,
    transport: row.transport,
    ...host === undefined ? {} : { host },
    state: row.disabled ? 'disabled' : 'connecting',
    toolCount: 0,
  }
}

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
