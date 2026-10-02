import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { McpServerStatus, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'
import McpStatusService from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client'

async function harness(withLoader = true): Promise<{ ctx: Context; service: McpStatusService }> {
  const ctx = new Context()
  contexts.push(ctx)
  if (withLoader) await ctx.plugin(Loader)
  await ctx.plugin(McpStatusService)
  return { ctx, service: ctx.get('mcpServerStatus') as McpStatusService }
}

function source(status: Partial<McpServerStatus> & { serverName: string }): McpServerStatusSource & { current: McpServerStatus } {
  const initial: McpServerStatus = { transport: 'stdio', phase: 'connected', toolCount: 0, ...status }
  const self = {
    current: initial,
    status: (): McpServerStatus => self.current,
  }
  return self
}

describe('McpStatusService', () => {
  it('publishes the status read and the profile writes under the mcpStatus namespace', async () => {
    const { service } = await harness()
    expect(service.typertRemote).toMatchObject({ serviceKey: 'mcpServerStatus', namespace: 'mcpStatus' })
    expect(remoteMethods(service).map(entry => entry.method)).toEqual(['list', 'save', 'setEnabled', 'removeServer', 'openConfigFile'])
  })

  it('answers an empty list when nothing is configured', async () => {
    const { service } = await harness()
    expect(service.list()).toEqual({ servers: [], management: { writable: false, readOnlyReason: 'no-profile' } })
  })

  it('projects each registered connection on every call and drops it with its plugin', async () => {
    const { ctx, service } = await harness()
    const beta = source({ serverName: 'beta', phase: 'connecting' })
    const alpha = source({
      serverName: 'alpha', transport: 'streamable-http', host: 'mcp.example.com', toolCount: 4,
      phase: 'error', error: 'Connection lost', retry: { attempt: 1, maxAttempts: 10 },
    })
    const fiber = await ctx.plugin({
      inject: ['mcpServerStatus'],
      apply(inner: Context) {
        inner.mcpServerStatus.register(beta)
        inner.mcpServerStatus.register(alpha)
      },
    })

    expect(service.list().servers).toEqual([
      {
        key: 'alpha', serverName: 'alpha', transport: 'streamable-http', host: 'mcp.example.com', state: 'error',
        toolCount: 4, error: 'Connection lost', retry: { attempt: 1, maxAttempts: 10 },
      },
      { key: 'beta', serverName: 'beta', transport: 'stdio', state: 'connecting', toolCount: 0 },
    ])

    beta.current = { ...beta.current, phase: 'error', halted: 'attempts-exhausted', error: 'gone' }
    expect(service.list().servers[1]).toMatchObject({ state: 'error', halted: 'attempts-exhausted', error: 'gone' })

    await fiber.dispose()
    expect(service.list().servers).toEqual([])
  })

  it('keeps servers that share a name in different scopes distinct', async () => {
    const { ctx, service } = await harness()
    await ctx.plugin({
      inject: ['mcpServerStatus'],
      apply(inner: Context) {
        inner.mcpServerStatus.register(source({ serverName: 'docs', toolCount: 1 }))
        inner.mcpServerStatus.register(source({ serverName: 'docs', toolCount: 2 }))
      },
    })
    const servers = service.list().servers
    expect(servers.map(server => server.key)).toEqual(['docs', 'docs#1'])
    expect(servers.map(server => server.toolCount)).toEqual([1, 2])
  })

  it('lists disabled and waiting mcp-client entries the connections cannot report', async () => {
    const { ctx, service } = await harness()
    await ctx.loader.create({
      name: MCP_CLIENT, disabled: true,
      config: { serverName: 'off', transport: 'streamable-http', url: 'https://mcp.example.com:9/v1?token=hunter2', headers: { Authorization: 'Bearer hunter2' } },
    })
    // The real plugin needs the `tools` service this harness lacks, so its root Fiber stays pending.
    const waitingId = await ctx.loader.create({ name: MCP_CLIENT, config: { transport: 'stdio', command: 'x', args: ['--token', 'hunter2'] } })
    const servers = service.list().servers
    const off = servers.find(server => server.serverName === 'off')
    expect(off).toEqual({
      key: 'off', serverName: 'off', transport: 'streamable-http', host: 'mcp.example.com:9', state: 'disabled', toolCount: 0,
    })
    expect(servers.find(server => server.serverName === waitingId)).toEqual({
      key: waitingId, serverName: waitingId, transport: 'stdio', state: 'connecting', toolCount: 0,
    })
    expect(JSON.stringify(servers)).not.toMatch(/hunter2|Authorization|token|v1/)
  })

  it('reads only literal identity fields from an entry and falls back to the entry id', async () => {
    const { ctx, service } = await harness()
    const idLiteral = await ctx.loader.create({ name: MCP_CLIENT, disabled: true, config: { serverName: { __jsExpr: 'process.env.SECRET' }, transport: 'stdio', url: 'https://ignored.example.com' } })
    await ctx.loader.create({ name: MCP_CLIENT, disabled: true, config: { serverName: 'bad-url', transport: 'streamable-http', url: 'not a url' } })
    const idBare = await ctx.loader.create({ name: MCP_CLIENT, disabled: true })
    await ctx.loader.create({ name: 'cordis:unrelated', disabled: true })
    await ctx.loader.create({ name: MCP_CLIENT, group: true })
    const byName = new Map(service.list().servers.map(server => [server.serverName, server]))
    expect(byName.get(idLiteral)).toMatchObject({ transport: 'stdio', state: 'disabled' })
    expect(byName.get(idLiteral)).not.toHaveProperty('host')
    expect(byName.get('bad-url')).toMatchObject({ transport: 'streamable-http', state: 'disabled' })
    expect(byName.get('bad-url')).not.toHaveProperty('host')
    expect(byName.get(idBare)).toMatchObject({ transport: null, state: 'disabled' })
    expect(byName.size).toBe(3)
  })

  it('reports an entry waiting on a dependency as connecting and a failed entry as load-failed', async () => {
    const { service } = await harness(false)
    const entries = [
      { id: 'waiting', options: { name: MCP_CLIENT, config: { serverName: 'waiting' } }, disabled: false, fiber: { state: 0 as FiberState } },
      { id: 'unborn', options: { name: MCP_CLIENT, config: { serverName: 'unborn' } }, disabled: false, fiber: undefined },
      { id: 'group', options: { name: MCP_CLIENT, group: true }, disabled: false, fiber: undefined },
      { id: 'live', options: { name: MCP_CLIENT, config: { serverName: 'live' } }, disabled: false, fiber: { state: 0 as FiberState } },
      { id: 'running', options: { name: MCP_CLIENT, config: { serverName: 'running' } }, disabled: false, fiber: { state: 2 as FiberState } },
      { id: 'broken', options: { name: MCP_CLIENT, config: { serverName: 'broken' } }, disabled: false, fiber: { state: 3 as FiberState } },
    ]
    const fakeCtx = contexts[0]!
    fakeCtx.provide('loader', { entries: () => entries } as never)
    service.register(source({ serverName: 'live' }))
    expect(service.list().servers.map(({ serverName, state, halted }) => ({ serverName, state, halted }))).toEqual([
      { serverName: 'broken', state: 'error', halted: 'load-failed' },
      { serverName: 'live', state: 'connected', halted: undefined },
      { serverName: 'unborn', state: 'error', halted: 'load-failed' },
      { serverName: 'waiting', state: 'connecting', halted: undefined },
    ])
  })

  it('serves live connections when no Loader is composed', async () => {
    const { ctx, service } = await harness(false)
    await ctx.plugin({ inject: ['mcpServerStatus'], apply(inner: Context) { inner.mcpServerStatus.register(source({ serverName: 'solo', toolCount: 2 })) } })
    expect(service.list().servers).toEqual([
      { key: 'solo', serverName: 'solo', transport: 'stdio', state: 'connected', toolCount: 2 },
    ])
  })
})
