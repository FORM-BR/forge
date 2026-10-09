import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { ANTHROPIC_THINKING_BINDING_BETA, dropStaleThinkingBlocks } from '../src/thinking-binding.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

beforeEach(() => {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
})

/** A complete minimal text generation in pi-ai's anthropic-messages SSE shape. */
function anthropicTextEvents(model: string): { event: string; data: string }[] {
  return [
    { event: 'message_start', data: JSON.stringify({
      type: 'message_start',
      message: { id: 'msg_01', model, usage: { input_tokens: 3, output_tokens: 1 } },
    }) },
    { event: 'content_block_start', data: JSON.stringify({
      type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
    }) },
    { event: 'content_block_delta', data: JSON.stringify({
      type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' },
    }) },
    { event: 'content_block_stop', data: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
    { event: 'message_delta', data: JSON.stringify({
      type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 },
    }) },
    { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
  ]
}

async function harness(providers: Record<string, LlmPiAi.PiAiProviderProfile>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers })
  return ctx
}

/** The `betas` pi-ai put on the wire: the SDK moves them to the `anthropic-beta` header. */
function betaHeader(server: Awaited<ReturnType<typeof mockServer>>): string[] {
  const value = server.headers[0]?.['anthropic-beta']
  return typeof value === 'string' ? value.split(',').map(beta => beta.trim()) : []
}

describe('dropStaleThinkingBlocks', () => {
  it('binds an enabled thinking block and declares the beta', () => {
    const params = { thinking: { type: 'enabled', budget_tokens: 1024 } }
    expect(dropStaleThinkingBlocks(params, true)).toBeUndefined()
    expect(params).toEqual({
      thinking: {
        type: 'enabled',
        budget_tokens: 1024,
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      },
      betas: [ANTHROPIC_THINKING_BINDING_BETA],
    })
  })

  it('preserves existing betas and never duplicates the binding beta', () => {
    const params = { betas: ['interleaved-thinking-2025-05-14'], thinking: { type: 'adaptive' } }
    dropStaleThinkingBlocks(params, true)
    dropStaleThinkingBlocks(params, true)
    expect(params.betas).toEqual(['interleaved-thinking-2025-05-14', ANTHROPIC_THINKING_BINDING_BETA])
  })

  it('leaves a disabled thinking block untouched', () => {
    const params = { thinking: { type: 'disabled' } }
    dropStaleThinkingBlocks(params, true)
    expect(params).toEqual({ thinking: { type: 'disabled' } })
  })

  it('synthesizes adaptive thinking for a reasoning model pi-ai left unconfigured', () => {
    const params: Record<string, unknown> = {}
    dropStaleThinkingBlocks(params, true)
    expect(params).toEqual({
      thinking: {
        type: 'adaptive',
        display: 'summarized',
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      },
      betas: [ANTHROPIC_THINKING_BINDING_BETA],
    })
  })

  it('no-ops for a non-reasoning model with no thinking field', () => {
    const params: Record<string, unknown> = {}
    dropStaleThinkingBlocks(params, false)
    expect(params).toEqual({})
  })

  it('no-ops on non-object input', () => {
    expect(dropStaleThinkingBlocks(null, true)).toBeUndefined()
    expect(dropStaleThinkingBlocks(undefined, true)).toBeUndefined()
  })
})

describe('Anthropic thinking binding on the wire', () => {
  it('binds enabled thinking on a first-party Anthropic model', async () => {
    const server = await mockServer([{ events: anthropicTextEvents('claude-haiku-4-5') }])
    const ctx = await harness({ anthropic: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    const result = await assemble(ctx, {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    const request = server.requests[0] as { thinking?: unknown }
    expect(request.thinking).toMatchObject({
      type: 'enabled',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(betaHeader(server)).toContain(ANTHROPIC_THINKING_BINDING_BETA)
  })

  it('declares adaptive binding when pi-ai leaves a reasoning model unconfigured', async () => {
    const server = await mockServer([{ events: anthropicTextEvents('claude-fable-5') }])
    const ctx = await harness({ anthropic: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, { provider: 'anthropic', model: 'claude-fable-5', messages: [] })
    const request = server.requests[0] as { thinking?: unknown }
    expect(request.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(betaHeader(server)).toContain(ANTHROPIC_THINKING_BINDING_BETA)
  })

  it('keeps pi-ai managed-effort binding without duplicating the beta', async () => {
    const server = await mockServer([{ events: anthropicTextEvents('claude-fable-5-1') }])
    const ctx = await harness({ anthropic: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, {
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    const request = server.requests[0] as { output_config?: unknown; thinking?: unknown }
    expect(request.thinking).toMatchObject({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    })
    expect(request.output_config).toEqual({ effort: 'high' })
    expect(betaHeader(server).filter(beta => beta === ANTHROPIC_THINKING_BINDING_BETA)).toHaveLength(1)
  })

  it('leaves non-Anthropic routes untouched', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness({ deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    const request = server.requests[0] as { thinking?: unknown }
    expect(server.requests[0]).not.toHaveProperty('betas')
    expect(request.thinking).toEqual({ type: 'disabled' })
    expect(request.thinking).not.toHaveProperty('block_binding')
    expect(betaHeader(server)).toEqual([])
  })
})
