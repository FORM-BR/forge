/**
 * Safe mode composition: shipped bundles and shipped-row configuration survive, everything that would
 * mount third-party code is dropped in memory, and no profile file is touched.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  composeEntries,
  filterSafeModePatches,
  initProfile,
  isSafeModeBundle,
  isSafeModeRequested,
  readSafeReason,
  PROFILE_PATCH_FILENAME,
  readProfilePatches,
  resolveProfileDir,
  SAFE_MODE_ENV,
  SAFE_REASON_ENV,
  type ProfileContext,
} from '../src/index.ts'

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-safe-')))
  roots.push(dir)
  return dir
}

/** A fake installation shipping one base bundle and holding one out-of-tree bundle. */
function stageInstallation(): string {
  const appDir = join(tmp(), 'app')
  const bundles: Record<string, string> = {
    '@deepseek-ai/dsh-base': '- insert:\n  - id: llm\n    name: "@deepseek-ai/dsh-llm-pi-ai"\n    config: {}\n  - id: shell\n    name: "@deepseek-ai/dsh-shell"\n',
    'third-party-bundle': '- insert:\n  - id: pet\n    name: third-party-pet\n',
  }
  mkdirSync(join(appDir, 'node_modules'), { recursive: true })
  for (const [name, patch] of Object.entries(bundles)) {
    const dir = join(appDir, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name, version: '0.0.0', type: 'module', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(dir, 'index.js'), 'export {}\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'dsh-app', version: '0.0.0', type: 'module', main: './index.js', dependencies: { '@deepseek-ai/dsh-base': '0.0.0', 'third-party-bundle': '0.0.0' },
  }))
  return join(appDir, 'package.json')
}

const USER_PATCH = `
- id: llm
  config:
    providers: { mine: { api: openai-completions } }
- id: pet
  config: { name: rex }
- insert:
    - id: extra-shipped
      name: "@deepseek-ai/dsh-todo"
    - id: extra-third-party
      name: some-community-plugin
    - id: mcp-one
      name: "@deepseek-ai/dsh-mcp-client"
    - id: include-one
      name: "@deepseek-ai/cordis-plugin-include"
- id: pet
  insert:
    - id: nested
      name: "@deepseek-ai/dsh-todo"
- id: extra-third-party
  disabled: true
`

function stageContext(safeMode: boolean): { context: ProfileContext; patchPath: string } {
  const home = tmp()
  const installAnchor = stageInstallation()
  const dir = resolveProfileDir('web', home)
  initProfile(dir, ['@deepseek-ai/dsh-base', 'third-party-bundle'])
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  writeFileSync(patchPath, USER_PATCH)
  writeFileSync(join(home, PROFILE_PATCH_FILENAME), '- insert:\n  - id: home-mcp\n    name: "@deepseek-ai/dsh-mcp-client"\n')
  return {
    patchPath,
    context: {
      name: 'web', dir, patchPath, installAnchor, home, cwd: home,
      startedBundles: ['@deepseek-ai/dsh-base', 'third-party-bundle'], overlays: [], telemetryDisabledEnv: undefined,
      ...(safeMode ? { safeMode } : {}),
    },
  }
}

const ids = (context: ProfileContext): (string | undefined)[] =>
  composeEntries([readProfilePatches('test', context)]).map(row => row.id)

describe('safe mode request', () => {
  it('turns on from the flag or from a truthy FORGE_SAFE_MODE', () => {
    expect(isSafeModeRequested(true, {})).toBe(true)
    expect(isSafeModeRequested(false, {})).toBe(false)
    for (const value of ['1', 'true', 'yes']) expect(isSafeModeRequested(false, { [SAFE_MODE_ENV]: value })).toBe(true)
    for (const value of ['', '0', 'false', ' False ', undefined]) expect(isSafeModeRequested(false, { [SAFE_MODE_ENV]: value })).toBe(false)
  })

  it('keeps the shipped template bundles and drops the rest', () => {
    expect(isSafeModeBundle('@deepseek-ai/dsh-base')).toBe(true)
    expect(isSafeModeBundle('@deepseek-ai/dsh-web-app')).toBe(true)
    expect(isSafeModeBundle('@deepseek-ai/dsh-experimental-auto-review')).toBe(false)
    expect(isSafeModeBundle('third-party-bundle')).toBe(false)
  })
})

describe('safe mode reason', () => {
  it('reads one trimmed line from FORGE_SAFE_REASON and ignores it when empty', () => {
    expect(readSafeReason({})).toBeUndefined()
    expect(readSafeReason({ [SAFE_REASON_ENV]: '   ' })).toBeUndefined()
    expect(readSafeReason({ [SAFE_REASON_ENV]: ' plugin x\n  falhou  ' })).toBe('plugin x falhou')
    expect(readSafeReason({ [SAFE_REASON_ENV]: 'a'.repeat(500) })).toHaveLength(300)
  })
})

describe('readProfilePatches in safe mode', () => {
  it('composes every layer when safe mode is off', () => {
    const { context } = stageContext(false)
    expect(ids(context)).toEqual(['llm', 'shell', 'pet', 'extra-shipped', 'extra-third-party', 'mcp-one', 'include-one', 'home-mcp'])
  })

  it('keeps shipped rows and their configuration, and drops third-party bundles, rows and extensions', () => {
    const { context } = stageContext(true)
    expect(ids(context)).toEqual(['llm', 'shell', 'extra-shipped'])
    const llm = composeEntries([readProfilePatches('test', context)]).find(row => row.id === 'llm')
    expect(llm?.config).toEqual({ providers: { mine: { api: 'openai-completions' } } })
  })

  it('leaves the profile files exactly as they were', () => {
    const { context, patchPath } = stageContext(true)
    const manifestBefore = readFileSync(join(context.dir, 'package.json'), 'utf8')
    readProfilePatches('test', context)
    expect(readFileSync(patchPath, 'utf8')).toBe(USER_PATCH)
    expect(readFileSync(join(context.dir, 'package.json'), 'utf8')).toBe(manifestBefore)
  })
})

describe('filterSafeModePatches', () => {
  const trusted = [{ insert: [{ id: 'host', name: '@deepseek-ai/dsh-host', group: true, config: [{ id: 'inner', name: '@deepseek-ai/dsh-x' }] }] }]

  it('targets rows nested in shipped groups and filters inserted group children', () => {
    const kept = filterSafeModePatches(trusted, [
      { id: 'inner', disabled: true },
      { id: 'host', insert: [{ id: 'a', name: 'community' }, { id: 'b', name: '@deepseek-ai/dsh-y' }] },
      {
        insert: [
          { id: 'g1', name: 'cordis:group', group: true, config: [{ id: 'c', name: 'community' }, { id: 'd', name: '@deepseek-ai/dsh-z' }] },
          { id: 'g2', name: 'community-group', group: true },
        ],
      },
    ])
    expect(kept).toEqual([
      { id: 'inner', disabled: true },
      { id: 'host', insert: [{ id: 'b', name: '@deepseek-ai/dsh-y' }] },
      { insert: [{ id: 'g1', name: 'cordis:group', group: true, config: [{ id: 'd', name: '@deepseek-ai/dsh-z' }] }] },
    ])
  })

  it('drops a patch aimed at a row the safe composition never mounted', () => {
    expect(filterSafeModePatches(trusted, [
      { id: 'gone', disabled: true },
      { id: 'gone', insert: [{ id: 'e', name: '@deepseek-ai/dsh-y' }] },
    ])).toEqual([])
  })
})
