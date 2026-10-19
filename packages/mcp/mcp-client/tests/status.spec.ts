/**
 * Tests for MCP server status reporting: the connection supervisor's
 * `status()` snapshot across connect, failure, outage, and give-up, the
 * secret redaction applied to failure messages, and the registry seam.
 * Isolated file so vi.mock of the MCP SDK doesn't pollute other test suites.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config, McpServerStatusRegistry, McpServerStatusSource } from '@deepseek-ai/dsh-mcp-client'

const { mockConnect, mockClose, mockListTools, MockClient, instances } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  class MockClient {
    transport: object | undefined = {}
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    getServerCapabilities = () => ({ tools: {} })
    getInstructions(): string | undefined { return undefined }
    listResources = async () => ({ resources: [] })
    listTools = mockListTools
    callTool = vi.fn()
    constructor() { instances.push(this) }
  }
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, MockClient, instances }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
  StreamableHTTPClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () { return { close: () => Promise.resolve() } }),
}))

import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'
import { describeStatusError, endpointHost } from '@deepseek-ai/dsh-mcp-client/src/status.ts'

function stdioConfig(reconnect?: Config['reconnect'], overrides: Partial<Extract<Config, { transport: 'stdio' }>> = {}): Config {
  return {
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...reconnect === undefined ? {} : { reconnect },
    ...overrides,
  }
}

function httpConfig(url: string, headers: Record<string, string> = {}): Config {
  return {
    transport: 'streamable-http',
    serverName: 'web',
    url,
    headers,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return { tools: names.map(name => ({ name, inputSchema: { type: 'object' } })), nextCursor: undefined }
}

/** A registry service that keeps every registered source, as a status consumer would. */
function statusRegistry(ctx: Context): McpServerStatusSource[] {
  const sources: McpServerStatusSource[] = []
  class Registry extends Service implements McpServerStatusRegistry {
    constructor(owner: Context) { super(owner, 'mcpServerStatus') }
    register(source: McpServerStatusSource): () => void {
      // oxlint-disable-next-line typescript/no-misused-promises -- removal is synchronous; Cordis retains any pending fiber disposal
      return this.ctx.effect(() => {
        sources.push(source)
        return () => { sources.splice(sources.indexOf(source), 1) }
      }, 'test: mcpServerStatus.register')
    }
  }
  new Registry(ctx)
  return sources
}

function silence(ctx: Context): void {
  ctx.logger.warn = (() => {}) as typeof ctx.logger.warn
  ctx.logger.error = (() => {}) as typeof ctx.logger.error
  ctx.logger.info = (() => {}) as typeof ctx.logger.info
}

describe('MCP server status', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('alpha', 'beta'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    silence(ctx)
  })

  it('reports connecting, then connected with the synchronized tool count', async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers()
    mockConnect.mockImplementation(() => gate.promise)
    const handle = startConnection(ctx, stdioConfig(), resolveReconnectPolicy(undefined, 'reconnect'))
    try {
      expect(handle.status()).toEqual({ serverName: 'srv', transport: 'stdio', phase: 'connecting', toolCount: 0 })
      gate.resolve()
      await handle.ready
      expect(handle.status()).toEqual({ serverName: 'srv', transport: 'stdio', phase: 'connected', toolCount: 2 })
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reports only the host of a Streamable HTTP endpoint', async () => {
    const config = httpConfig('https://user:pw-secret@mcp.example.com:8443/v1/mcp?apikey=abc123def', { Authorization: 'Bearer abc123def' })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(undefined, 'reconnect'))
    try {
      await handle.ready
      const status = handle.status()
      expect(status).toEqual({
        serverName: 'web', transport: 'streamable-http', host: 'mcp.example.com:8443', phase: 'connected', toolCount: 2,
      })
      expect(JSON.stringify(status)).not.toMatch(/abc123def|pw-secret|Authorization|apikey/)
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('reports a failed first attempt with a redacted error and the retry counter', async () => {
    mockConnect.mockRejectedValue(new Error(
      'POST https://mcp.example.com/v1/mcp?token=hunter2hunter2 failed for key sk-live-12345 (Bearer sk-live-12345)',
    ))
    const config = stdioConfig({ initialDelayMs: 1000, maxDelayMs: 2000, maxAttempts: 3 }, { env: { API_KEY: 'sk-live-12345' } })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
    try {
      await handle.ready
      const status = handle.status()
      expect(status).toMatchObject({
        phase: 'error',
        toolCount: 0,
        error: 'POST https://mcp.example.com failed for key *** (Bearer ***)',
        retry: { attempt: 1, maxAttempts: 3 },
      })
      expect(status.halted).toBeUndefined()
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps the last known tools during an outage and clears the error after recovery', async () => {
    const config = stdioConfig({ initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 5 })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
    try {
      await handle.ready
      const gate: PromiseWithResolvers<void> = Promise.withResolvers()
      mockConnect.mockImplementationOnce(() => gate.promise)
      instances[0]!.onclose?.()
      expect(handle.status()).toEqual({
        serverName: 'srv', transport: 'stdio', phase: 'error', toolCount: 2,
        error: 'Connection lost', retry: { attempt: 1, maxAttempts: 5 },
      })
      await vi.waitFor(() => { expect(instances).toHaveLength(2) })
      expect(handle.status()).toMatchObject({ phase: 'connecting', error: 'Connection lost', retry: { attempt: 1 } })
      gate.resolve()
      await vi.waitFor(() => { expect(handle.status().phase).toBe('connected') })
      const recovered = handle.status()
      expect(recovered.error).toBeUndefined()
      expect(recovered.retry).toBeUndefined()
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('marks the server halted once the attempt budget is exhausted and its tools are gone', async () => {
    const config = stdioConfig({ initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 1 })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
    try {
      await handle.ready
      mockConnect.mockRejectedValue(new Error('server gone'))
      instances[0]!.onclose?.()
      await vi.waitFor(() => { expect(handle.status().halted).toBe('attempts-exhausted') })
      await vi.waitFor(() => { expect(handle.status().toolCount).toBe(0) })
      expect(handle.status()).toMatchObject({ phase: 'error', error: 'server gone' })
      expect(handle.status().retry).toBeUndefined()
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('marks the server halted when reconnect is disabled', async () => {
    const config = stdioConfig({ enabled: false })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
    try {
      await handle.ready
      instances[0]!.onclose?.()
      expect(handle.status()).toEqual({
        serverName: 'srv', transport: 'stdio', phase: 'error', toolCount: 2,
        error: 'Connection lost', halted: 'reconnect-disabled',
      })
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('explains a connection that closed before it was ready', async () => {
    const config = stdioConfig({ enabled: false })
    mockConnect.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
    try {
      await handle.ready
      expect(handle.status()).toMatchObject({
        phase: 'error', error: 'Connection closed before it was ready', halted: 'reconnect-disabled',
      })
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('marks the server halted when a failed generation never confirms transport closure', async () => {
    vi.useFakeTimers()
    try {
      mockConnect.mockRejectedValue(new Error('initialize failed'))
      mockClose.mockResolvedValue(undefined)
      const config = stdioConfig({ initialDelayMs: 2, maxDelayMs: 8, maxAttempts: 2 })
      const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'reconnect'))
      await vi.advanceTimersByTimeAsync(5_000)
      await handle.ready
      expect(handle.status()).toMatchObject({ phase: 'error', error: 'initialize failed', halted: 'transport-unconfirmed' })
      await handle.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers the plugin with a composed registry and withdraws it on disposal', async () => {
    const sources = statusRegistry(ctx)
    const fiber = await ctx.plugin({ apply, inject: ['tools'] }, stdioConfig())
    expect(sources).toHaveLength(1)
    expect(sources[0]!.status()).toMatchObject({ serverName: 'srv', phase: 'connected', toolCount: 2 })
    await fiber.dispose()
    expect(sources).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('runs unchanged when no registry is composed', async () => {
    const fiber = await ctx.plugin({ apply, inject: ['tools'] }, stdioConfig())
    expect(ctx.tools.get('mcp__srv__alpha')).toBeDefined()
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

describe('describeStatusError', () => {
  it('masks configured secrets, URL details, and credentials', () => {
    const config = stdioConfig(undefined, {
      env: { TOKEN: 'ghp_abcdef123456', SHORT: 'x' },
      args: ['-y', '@scope/server', '--api-key=sup3rsecret', '--token', 'tok-987654321'],
    })
    const message = describeStatusError(
      new Error('spawn failed: ghp_abcdef123456 sup3rsecret tok-987654321 at https://u:p@host.test:9/a/b?q=1 basic: Basic dXNlcjpwYXNz'),
      config,
    )
    expect(message).toBe('spawn failed: *** *** *** at https://host.test:9 basic: Basic ***')
  })

  it('tolerates a sensitive flag with no value after it', () => {
    expect(describeStatusError(new Error('bad --token flag'), stdioConfig(undefined, { args: ['--token'] }))).toBe('bad --token flag')
  })

  it('masks header values and URL query values of an HTTP server', () => {
    const config = httpConfig('https://h.test/mcp?access=querysecret', { 'X-Key': 'headersecret' })
    expect(describeStatusError(new Error('bad headersecret then querysecret'), config)).toBe('bad *** then ***')
  })

  it('replaces an unparsable URL, collapses whitespace, and bounds the length', () => {
    const config = httpConfig('not a url')
    expect(describeStatusError(new Error('bad http://[::1 endpoint\n\n  here'), config)).toBe('bad [url] endpoint here')
    const long = describeStatusError(new Error('x'.repeat(500)), config)
    expect(long).toHaveLength(240)
    expect(long.endsWith('…')).toBe(true)
  })

  it('stringifies non-Error values and names an empty message', () => {
    const config = stdioConfig()
    expect(describeStatusError('plain failure', config)).toBe('plain failure')
    expect(describeStatusError(new Error(' '), config)).toBe('Unknown error')
  })

  it('reads the endpoint host only for a parsable Streamable HTTP URL', () => {
    expect(endpointHost(stdioConfig())).toBeUndefined()
    expect(endpointHost(httpConfig('not a url'))).toBeUndefined()
    expect(endpointHost(httpConfig('http://localhost:3000/mcp?a=b'))).toBe('localhost:3000')
  })
})
