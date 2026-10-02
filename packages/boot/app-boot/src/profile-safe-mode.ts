/**
 * Safe mode: boot a profile from the shipped bundles only, without touching any file.
 *
 * A profile's composition has four sources: bundle layers (`dsh.profile.bundles`), the profile's own
 * patch file, the Harness-home patch file, and `--patch` overlays. Safe mode keeps the shipped bundle
 * layers and, from the three user-owned sources, only what configures an already-mounted shipped row
 * (id-targeted overrides such as the model provider or a disabled flag) or inserts a shipped row.
 * Anything that would mount third-party code (out-of-tree bundles, rows naming a non-shipped module,
 * MCP client connections, nested includes) is dropped from the composition in memory.
 *
 * Nothing is persisted: leaving safe mode is just booting again without the flag, so the user's
 * `cordis.patch.yml`, `package.json` and installed packages are never edited or backed up.
 * @module @deepseek-ai/dsh-app-boot/profile-safe-mode
 */

import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, PROFILE_TEMPLATES } from './profile.ts'

/** Environment switch that boots in safe mode; any value but empty, `0` or `false` turns it on. */
export const SAFE_MODE_ENV = 'FORGE_SAFE_MODE'

/** Module-name prefix of everything the dsh installation ships. */
const SHIPPED_MODULE_PREFIX = '@deepseek-ai/'

/**
 * Shipped modules that still load code or processes the user chose: MCP servers are spawned from the
 * user's own config, and an include mounts an arbitrary file's rows.
 */
const USER_EXTENSION_MODULES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/cordis-plugin-include',
])

/**
 * Resolve whether a launch asks for safe mode.
 * @param flag - the `--safe` launcher flag.
 * @param environment - the launch environment, read for {@link SAFE_MODE_ENV}.
 * @returns true when either the flag or a truthy environment switch asks for it.
 */
export function isSafeModeRequested(flag: boolean, environment: Readonly<Record<string, string | undefined>>): boolean {
  if (flag) return true
  const value = (environment[SAFE_MODE_ENV] ?? '').trim().toLowerCase()
  return value !== '' && value !== '0' && value !== 'false'
}

/** Read lazily: this module sits in an import cycle with the profile module, so its exports may not exist at load. */
function safeBundles(): ReadonlySet<string> {
  return new Set(Object.values(PROFILE_TEMPLATES).flatMap(template => template.bundles))
}

/**
 * Whether a bundle belongs to the safe composition: the ones the shipped profile templates select.
 * Optional experimental bundles and every out-of-tree bundle are left out.
 * @param packageName - bundle package name from `dsh.profile.bundles`.
 * @returns true when the bundle is part of the shipped base.
 */
export function isSafeModeBundle(packageName: string): boolean {
  return safeBundles().has(packageName)
}

function isShippedRow(row: EntryOptions): boolean {
  // Hand-written patch rows may omit the name even though the loader type requires it.
  const name: unknown = row.name
  // A pure group row carries children only; its children are filtered one by one.
  if (row.group === true && (name === undefined || name === '' || name === 'cordis:group')) return true
  if (typeof name !== 'string') return false
  return name.startsWith(SHIPPED_MODULE_PREFIX) && !USER_EXTENSION_MODULES.has(name)
}

/** Keep the shipped rows of an insert list, recursing into group children. */
function shippedRows(rows: readonly EntryOptions[]): EntryOptions[] {
  const kept: EntryOptions[] = []
  for (const row of rows) {
    if (!isShippedRow(row)) continue
    kept.push(row.group === true && Array.isArray(row.config)
      ? { ...row, config: shippedRows(row.config as EntryOptions[]) }
      : row)
  }
  return kept
}

function collectIds(rows: readonly EntryOptions[], into: Set<string>): void {
  for (const row of rows) {
    if (typeof row.id === 'string') into.add(row.id)
    if (row.group === true && Array.isArray(row.config)) collectIds(row.config as EntryOptions[], into)
  }
}

/**
 * Reduce user-owned patch lists to what safe mode accepts, preserving order.
 * @param trusted - the already-filtered bundle layer patches; their rows are the mounted shipped base.
 * @param user - the profile, home and overlay patches, in application order.
 * @returns the patches that only configure or add shipped rows; the input is never mutated.
 */
export function filterSafeModePatches(trusted: readonly PatchOptions[], user: readonly PatchOptions[]): PatchOptions[] {
  const known = new Set<string>()
  collectIds(composeEntries([[...trusted]]), known)
  const kept: PatchOptions[] = []
  for (const patch of user) {
    if (patch.insert !== undefined) {
      if (patch.id !== undefined && !known.has(patch.id)) continue
      const rows = shippedRows(patch.insert)
      if (rows.length === 0) continue
      collectIds(rows, known)
      kept.push({ ...patch, insert: rows })
      continue
    }
    if (patch.id !== undefined && known.has(patch.id)) kept.push(patch)
  }
  return kept
}
