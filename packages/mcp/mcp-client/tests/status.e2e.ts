/**
 * End-to-end test of MCP server status reporting against the REAL stdio
 * fixture server: the reported state follows a live connection, a post-reply
 * crash, the automatic reconnect, and a server command that cannot start.
 * No API key needed.
 */

import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import type { Config, McpServerStatus, McpServerStatusRegistry, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'

const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function mount(): Promise<{ ctx: Context; statuses: () => McpServerStatus[] }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const sources = new Set<McpServerStatusSource>()
  class Registry extends Service implements McpServerStatusRegistry {
    constructor(owner: Context) { super(owner, 'mcpServerStatus') }
    register(source: McpServerStatusSource): () => void {
      // oxlint-disable-next-line typescript/no-misused-promises -- removal is synchronous; Cordis retains any pending fiber disposal
      return this.ctx.effect(() => {
        sources.add(source)
        return () => { sources.delete(source) }
      }, 'test: mcpServerStatus.register')
    }
  }
  new Registry(ctx)
  return { ctx, statuses: () => [...sources].map(source => source.status()) }
}

function fixtureConfig(serverName: string, reconnect: NonNullable<Config['reconnect']>): Config {
  return {
    transport: 'stdio',
    serverName,
    command: process.execPath,
    args: [fixtureServerPath],
    env: { FIXTURE_TOKEN: 'super-secret-token' },
    cwd: packageDir,
    toolCallTimeoutMs: 15_000,
    failOnStartupError: false,
    reconnect,
  }
}

describe('MCP server status — real stdio server', () => {
  it('reports connected, then error with a retry after a crash, then connected again', async () => {
    const { ctx, statuses } = await mount()
    await ctx.plugin({ apply, inject: ['tools'] }, fixtureConfig('crashy', { initialDelayMs: 300, maxDelayMs: 1000, maxAttempts: 40 }))
    expect(statuses()).toHaveLength(1)
    expect(statuses()[0]).toEqual({ serverName: 'crashy', transport: 'stdio', phase: 'connected', toolCount: 6 })

    await ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('status-crash'), name: 'mcp__crashy__crash', arguments: {},
    })
    await vi.waitFor(() => { expect(statuses()[0]!.phase).not.toBe('connected') }, { timeout: 5_000 })
    expect(statuses()[0]).toMatchObject({ serverName: 'crashy', error: 'Connection lost', retry: { attempt: 1, maxAttempts: 40 } })

    await vi.waitFor(() => { expect(statuses()[0]!.phase).toBe('connected') }, { timeout: 15_000 })
    expect(statuses()[0]).toEqual({ serverName: 'crashy', transport: 'stdio', phase: 'connected', toolCount: 6 })
  }, 30_000)

  it('reports a server that cannot start with a short message free of the configured secret', async () => {
    const { ctx, statuses } = await mount()
    const config: Config = {
      transport: 'stdio',
      serverName: 'missing',
      command: `${process.execPath}-does-not-exist`,
      args: ['--token', 'super-secret-token'],
      env: { FIXTURE_TOKEN: 'super-secret-token' },
      cwd: packageDir,
      toolCallTimeoutMs: 5_000,
      failOnStartupError: false,
      reconnect: { initialDelayMs: 60_000, maxDelayMs: 60_000, maxAttempts: 3 },
    }
    await ctx.plugin({ apply, inject: ['tools'] }, config)
    const status = statuses()[0]!
    expect(status).toMatchObject({ serverName: 'missing', phase: 'error', toolCount: 0, retry: { attempt: 1, maxAttempts: 3 } })
    expect(status.error).toBeTruthy()
    expect(status.error!.length).toBeLessThanOrEqual(240)
    expect(JSON.stringify(status)).not.toContain('super-secret-token')
  }, 30_000)
})
