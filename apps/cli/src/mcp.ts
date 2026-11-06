/** Toggle and list MCP server rows in a profile patch or the shared home patch. */
import { PROFILE_PATCH_FILENAME, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { McpPatchError, readMcpRows, setMcpRowEnabled } from '@deepseek-ai/dsh-api-mcp-status/patch-file'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What `dsh mcp` resolved to. */
export interface McpRunOptions {
  /** `profile` edits one profile's patch; `home` edits the shared patch that applies to every profile. */
  scope: 'profile' | 'home'
  /** Profile name when scope is `profile`. */
  profile?: string | undefined
  /** `on` and `off` flip the `disabled` flag of one row; `list` prints the rows. */
  operation: 'list' | 'on' | 'off'
  /** Loader entry id when operation is `on` or `off`. */
  id?: string | undefined
}

/** The patch file this invocation operates on, and the human label printed in messages. */
function controller(options: McpRunOptions): { label: string; path: string } {
  if (options.scope === 'home') {
    return { label: 'home', path: join(resolveDshHome(), PROFILE_PATCH_FILENAME) }
  }
  const profile = options.profile ?? ''
  return { label: `profile "${profile}"`, path: join(resolveProfileDir(profile), PROFILE_PATCH_FILENAME) }
}

/**
 * Run the `dsh mcp` command.
 * @param options - scope and operation resolved by the argument parser.
 * @returns Zero on success; nonzero on a missing row or an unreadable patch file.
 */
export async function runMcp(options: McpRunOptions): Promise<number> {
  try {
    const { label, path } = controller(options)
    if (options.operation === 'list') {
      const text = existsSync(path) ? await readFile(path, 'utf8') : ''
      const rows = readMcpRows(text)
      if (rows.length === 0) {
        process.stdout.write(`dsh: ${label}: no MCP servers configured (${path})\n`)
        return 0
      }
      process.stdout.write(`dsh: ${label}: MCP servers (${path}):\n`)
      for (const row of rows) {
        const state = row.disabled ? 'off' : 'on'
        const transport = row.transport ?? '?'
        process.stdout.write(`  ${state}\t${row.id}\t${transport}\t${row.serverName}\n`)
      }
      return 0
    }
    if (!existsSync(path)) {
      process.stderr.write(`dsh: no patch file at ${path}; define the server in the file before toggling it\n`)
      return 1
    }
    const enabled = options.operation === 'on'
    const id = options.id ?? ''
    let report: string
    try {
      report = await withFileLock(path, async () => {
        const text = await readFile(path, 'utf8')
        const next = setMcpRowEnabled(text, id, enabled)
        if (next === text) return `dsh: ${id} is already ${enabled ? 'on' : 'off'}\n`
        await writeFile(path, next, 'utf8')
        return `dsh: ${enabled ? 'on' : 'off'} ${id} in ${label}\n`
      }, { waitMs: 120000 })
    } catch (error) {
      if (error instanceof McpPatchError && error.kind === 'not-found') {
        process.stderr.write(`dsh: no MCP server with id ${JSON.stringify(id)} in ${label} (${path}); use 'dsh mcp list' to see the ids\n`)
        return 1
      }
      throw error
    }
    process.stdout.write(report)
    return 0
  } catch (error) {
    if (!(error instanceof McpPatchError)) {
      process.stderr.write(`dsh: ${String(error)}\n`)
      return 1
    }
    process.stderr.write(`dsh: ${error.message}\n`)
    return 1
  }
}
