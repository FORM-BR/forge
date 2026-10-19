import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { McpServerStatus, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'
import McpStatusService from '../src/index.ts'
import type { McpServerDraft } from '../src/index.ts'

const PROFILE = `# my profile
- insert:
    - id: mcp-docs
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: docs
        transport: stdio
        command: npx
        args: ['-y', '@scope/docs', '--token', 'tok-abcdef123456']
        env:
          DOCS_KEY: key-abcdef123456
`

const HOME = `- insert:
    - id: mcp-shared
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: shared
        transport: streamable-http
        url: https://mcp.example.com/mcp?key=hidden-value-1
        headers:
          Authorization: Bearer hidden-header-1
`

const contexts: Context[] = []
let dir: string
let editorCalls: Array<{ requiredIds: readonly string[] | undefined }>
let editorFailure: Error | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-management-'))
  editorCalls = []
  editorFailure = undefined
})

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})

interface Options {
  readonly safeMode?: boolean
  readonly profile?: boolean
  readonly files?: { readonly profile?: string; readonly home?: string }
}

async function harness(options: Options = {}): Promise<{ ctx: Context; service: McpStatusService; patch: string; home: string }> {
  const ctx = new Context()
  contexts.push(ctx)
  const patch = join(dir, 'profile.patch.yml')
  const home = join(dir, 'cordis.patch.yml')
  const files = options.files ?? { profile: PROFILE, home: HOME }
  if (files.profile !== undefined) writeFileSync(patch, files.profile)
  if (files.home !== undefined) writeFileSync(home, files.home)
  await ctx.plugin(McpStatusService)
  if (options.profile !== false) {
    ctx.provide('profileContext', { patchPath: patch, home: dir, ...options.safeMode === undefined ? {} : { safeMode: options.safeMode } } as never)
    ctx.provide('configEditor', {
      // Same contract as the real editor: derive the next text, write it, report the outcome.
      editDocument: (change: (before: string) => string, editOptions?: { requiredIds?: readonly string[] }) => {
        editorCalls.push({ requiredIds: editOptions?.requiredIds })
        if (editorFailure !== undefined) return Promise.reject(editorFailure)
        let before = '[]\n'
        try { before = readFileSync(patch, 'utf8') } catch { /* a missing profile patch starts empty */ }
        writeFileSync(patch, change(before))
        return Promise.resolve('applied')
      },
    } as never)
  }
  return { ctx, service: ctx.get('mcpServerStatus') as McpStatusService, patch, home }
}

function live(serverName: string, extra: Partial<McpServerStatus> = {}): McpServerStatusSource {
  return { status: () => ({ serverName, transport: 'stdio', phase: 'connected', toolCount: 3, ...extra }) }
}

const NEW: McpServerDraft = { name: 'fresh', transport: 'stdio', command: 'node', args: [{ value: 'srv.js' }], env: { TOKEN: 'brand-new-secret' } }

describe('list with definitions', () => {
  it('joins patch rows with live status and exposes no secret value', async () => {
    const { service } = await harness()
    service.register(live('docs'))
    const snapshot = service.list()
    const docs = snapshot.servers.find(server => server.serverName === 'docs')
    expect(docs).toMatchObject({
      state: 'connected', toolCount: 3, source: 'profile',
      config: {
        id: 'mcp-docs', disabled: false, editable: true, command: 'npx', envKeys: ['DOCS_KEY'],
        args: [
          { text: '-y', masked: false }, { text: '@scope/docs', masked: false },
          { text: '--token', masked: false }, { text: '••••', masked: true },
        ],
      },
    })
    const shared = snapshot.servers.find(server => server.serverName === 'shared')
    expect(shared).toMatchObject({
      source: 'home', pendingRestart: true, state: 'connecting', host: 'mcp.example.com',
      config: { id: 'mcp-shared', url: 'https://mcp.example.com/mcp?key=••••', urlMasked: true, headerKeys: ['Authorization'] },
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/abcdef123456|hidden-value-1|hidden-header-1/)
    expect(snapshot.management).toMatchObject({ writable: true })
    expect(snapshot.management.profileFile).toBeDefined()
  })

  it('reports read-only management without a profile or in safe mode', async () => {
    expect((await harness({ profile: false })).service.list().management).toEqual({ writable: false, readOnlyReason: 'no-profile' })
    expect((await harness({ safeMode: true })).service.list().management).toMatchObject({ writable: false, readOnlyReason: 'safe-mode' })
  })

  it('shows a disabled saved row as disabled, not connecting', async () => {
    const { service, patch } = await harness()
    writeFileSync(patch, PROFILE.replace("      name: '@deepseek-ai/dsh-mcp-client'\n", "      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n"))
    expect(service.list().servers.find(server => server.serverName === 'docs')).toMatchObject({ state: 'disabled', config: { disabled: true } })
  })
})

describe('writes', () => {
  it('adds a server under a derived id and asks the editor to require it', async () => {
    const { service, patch } = await harness()
    await expect(service.save(NEW, undefined)).resolves.toEqual({ outcome: 'applied', id: 'mcp-fresh' })
    expect(editorCalls).toEqual([{ requiredIds: ['mcp-fresh'] }])
    const text = readFileSync(patch, 'utf8')
    expect(text.startsWith(PROFILE)).toBe(true)
    expect(text).toContain('id: mcp-fresh')
    expect(text).toContain('TOKEN: brand-new-secret')
  })

  it('refuses a name another server already uses, in the profile or the home patch', async () => {
    const { service } = await harness()
    await expect(service.save({ ...NEW, name: 'docs' }, undefined)).rejects.toMatchObject({ code: 'mcpStatus/invalid', details: { field: 'name' } })
    await expect(service.save({ ...NEW, name: 'shared' }, undefined)).rejects.toMatchObject({ code: 'mcpStatus/invalid' })
  })

  it('edits in place, keeping stored secrets the draft marks as kept', async () => {
    const { service, patch } = await harness()
    await service.save({
      name: 'docs', transport: 'stdio', command: 'node', args: [{ value: 'srv.js' }, { keep: 2 }, { keep: 3 }], env: { DOCS_KEY: null },
    }, 'mcp-docs')
    const text = readFileSync(patch, 'utf8')
    expect(text).toContain('command: node')
    expect(text).toContain('tok-abcdef123456')
    expect(text).toContain('DOCS_KEY: key-abcdef123456')
    expect(text).not.toContain('@scope/docs')
  })

  it('toggles and removes a profile server', async () => {
    const { service, patch } = await harness()
    await expect(service.setEnabled('mcp-docs', false)).resolves.toEqual({ outcome: 'applied', id: 'mcp-docs' })
    expect(readFileSync(patch, 'utf8')).toContain('disabled: true')
    expect(editorCalls.at(-1)).toEqual({ requiredIds: [] })
    await service.setEnabled('mcp-docs', true)
    expect(editorCalls.at(-1)).toEqual({ requiredIds: ['mcp-docs'] })
    await service.removeServer('mcp-docs')
    expect(readFileSync(patch, 'utf8')).not.toContain('mcp-docs')
  })

  it('does not touch a home-defined server and reports a vanished one', async () => {
    const { service } = await harness()
    await expect(service.setEnabled('mcp-shared', false)).rejects.toMatchObject({ code: 'mcpStatus/read-only', details: { reason: 'defined-elsewhere' } })
    await expect(service.removeServer('mcp-shared')).rejects.toMatchObject({ code: 'mcpStatus/read-only' })
    await expect(service.removeServer('mcp-gone')).rejects.toMatchObject({ code: 'mcpStatus/not-found' })
    expect(editorCalls).toEqual([{ requiredIds: [] }])
  })

  it('rejects every write when the profile is read-only', async () => {
    await expect((await harness({ safeMode: true })).service.save(NEW, undefined)).rejects.toMatchObject({ code: 'mcpStatus/read-only', details: { reason: 'safe-mode' } })
    await expect((await harness({ profile: false })).service.removeServer('x')).rejects.toMatchObject({ code: 'mcpStatus/read-only', details: { reason: 'no-profile' } })
    expect(editorCalls).toEqual([])
  })

  it('reports an invalid draft as a field error', async () => {
    const { service } = await harness()
    await expect(service.save({ name: 'bad name', transport: 'stdio', command: 'x' }, undefined)).rejects.toMatchObject({
      code: 'mcpStatus/invalid', details: { field: 'name' },
    })
  })

  it('relays an apply failure without the submitted secrets', async () => {
    const { service } = await harness()
    editorFailure = new Error('entry mcp-fresh failed: spawn node ENOENT with brand-new-secret')
    const failure = await service.save(NEW, undefined).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'mcpStatus/apply-failed' })
    expect((failure as Error).message).toContain('spawn node ENOENT')
    expect((failure as Error).message).not.toContain('brand-new-secret')
  })

  it('falls back to a numbered id when the derived one is taken', async () => {
    const { service } = await harness({ files: { profile: PROFILE.replace('serverName: docs', 'serverName: other').replace('id: mcp-docs', 'id: mcp-fresh') } })
    await expect(service.save(NEW, undefined)).resolves.toMatchObject({ id: 'mcp-fresh-2' })
  })
})
