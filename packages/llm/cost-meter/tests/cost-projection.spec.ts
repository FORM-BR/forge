import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { costUsageProjectionDefinition, foldCostUsage, initCostUsageState } from '@deepseek-ai/dsh-cost-meter'
import type { CostUsageProjection } from '@deepseek-ai/dsh-cost-meter/client'
import type { ModelCostRates, PriceLookup } from '@deepseek-ai/dsh-cost-meter/client'

const RATES: ModelCostRates = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 }
const MOCK_RATES: ModelCostRates = { input: 4, output: 8, cacheRead: 1, cacheWrite: 0.5 }
const price: PriceLookup = (provider, model) => (
  provider === 'priced' && model === 'model-a' ? RATES
    : provider === 'priced' && model === 'model-b' ? MOCK_RATES
      : undefined
)

const USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 200 }

/** Append one settled assistant attempt and return its logged event. */
function settle(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
  provider = 'priced',
  model = 'model-a',
): SessionEvent {
  return session.append('assistant/message', {
    stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage } }],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider, model },
    }),
    usage,
  }, { surfaceOp: 'append' })
}

describe('foldCostUsage', () => {
  async function ctx() {
    const context = new Context()
    await context.plugin(SessionStore)
    return context
  }

  it('leaves the state untouched for non-assistant events', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const event = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const state = initCostUsageState()
    expect(foldCostUsage(state, event, price)).toBe(state)
  })

  it('leaves the state untouched for assistants without provider usage', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const event = session.append('assistant/message', {
      stream: [],
      turn: 0,
      step: 0,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'priced', model: 'model-a' } }),
    }, { surfaceOp: 'append' })
    const state = initCostUsageState()
    expect(foldCostUsage(state, event, price)).toBe(state)
  })

  it('prices one settlement at buckets times rates per 1M tokens', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const state = foldCostUsage(initCostUsageState(), settle(session, USAGE, 1, 1), price)
    // (1000*1 + 500*0.5 + 200*0.25 + 1000*2)/1M = (1000+250+50+2000)/1M
    expect(state.totalCostUsd).toBeCloseTo(0.0033, 12)
    expect(state.attempts).toBe(1)
    expect(state.unpricedAttempts).toBe(0)
    expect(state.byModel).toHaveLength(1)
    expect(state.byModel[0]).toMatchObject({
      provider: 'priced', model: 'model-a', costUsd: 0.0033, attempts: 1,
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 200,
    })
  })

  it('uses the provider-billed cost instead of the catalog estimate', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const state = foldCostUsage(initCostUsageState(), settle(session, { ...USAGE, costUsd: 0.0123 }, 1, 1), price)
    expect(state.totalCostUsd).toBe(0.0123)
    expect(state.unpricedAttempts).toBe(0)
  })

  it('counts a billed attempt on an uncatalogued route as priced', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const state = foldCostUsage(
      initCostUsageState(),
      settle(session, { ...USAGE, costUsd: 0.5 }, 1, 1, 'unpriced-provider', 'unknown-model'),
      price,
    )
    expect(state.totalCostUsd).toBe(0.5)
    expect(state.unpricedAttempts).toBe(0)
  })

  it('counts unpriced routes as zero cost with unpricedAttempts', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const state = foldCostUsage(initCostUsageState(), settle(session, USAGE, 1, 1, 'unpriced-provider', 'unknown-model'), price)
    expect(state.totalCostUsd).toBe(0)
    expect(state.unpricedAttempts).toBe(1)
    expect(state.byModel[0]).toMatchObject({ provider: 'unpriced-provider', costUsd: 0 })
  })

  it('an unpriced model still records its tokens', async () => {
    const context = await ctx()
    const session = context.sessions.create()
    const state = foldCostUsage(initCostUsageState(), settle(session, USAGE, 1, 1, 'unpriced-provider', 'unknown-model'), price)
    expect(state.byModel[0]).toMatchObject({ inputTokens: 1000, outputTokens: 1000 })
  })
})

describe('costUsage session projection', () => {
  async function harness() {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(costUsageProjectionDefinition(price))
    return { ctx, session: ctx.sessions.create() }
  }

  const projected = (ctx: Context, session: Session): CostUsageProjection => {
    const value = ctx.sessionProjections.snapshot(session).values.costUsage
    if (value === undefined) throw new Error('costUsage projection is not registered')
    return value
  }

  it('serves zero cost before any usage sample', async () => {
    const { ctx, session } = await harness()
    expect(projected(ctx, session)).toEqual({
      totalCostUsd: 0, attempts: 0, unpricedAttempts: 0, byModel: [],
    })
  })

  it('prices one settlement and attributes the route row', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    const projection = projected(ctx, session)
    expect(projection.totalCostUsd).toBeCloseTo(0.0033, 12)
    expect(projection.attempts).toBe(1)
    expect(projection.unpricedAttempts).toBe(0)
    expect(projection.byModel).toHaveLength(1)
    expect(projection.byModel[0]).toMatchObject({
      provider: 'priced', model: 'model-a', costUsd: 0.0033, attempts: 1,
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 200,
    })
  })

  it('a retry on the same slot replaces instead of double counting', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    settle(session, { inputTokens: 2000, outputTokens: 2000 }, 1, 1)
    const projection = projected(ctx, session)
    // (2000*1 + 2000*2)/1M = 6e-3; attempts stay 1
    expect(projection.totalCostUsd).toBeCloseTo(0.006, 12)
    expect(projection.attempts).toBe(1)
    expect(projection.byModel[0]!.inputTokens).toBe(2000)
  })

  it('a later slot adds to the same route row', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1) // 0.0033
    settle(session, { inputTokens: 1000, outputTokens: 1000 }, 1, 2) // +0.003
    const projection = projected(ctx, session)
    expect(projection.attempts).toBe(2)
    expect(projection.totalCostUsd).toBeCloseTo(0.0063, 12)
    expect(projection.byModel[0]!.attempts).toBe(2)
  })

  it('moves the contribution when a slot switches models', async () => {
    const { ctx, session } = await harness()
    settle(session, { inputTokens: 1000, outputTokens: 0 }, 1, 1, 'priced', 'model-a') // 0.001
    settle(session, { inputTokens: 1000, outputTokens: 0 }, 1, 1, 'priced', 'model-b') // 0.004
    const projection = projected(ctx, session)
    expect(projection.attempts).toBe(1)
    expect(projection.totalCostUsd).toBeCloseTo(0.004, 12)
    expect(projection.byModel).toHaveLength(1)
    expect(projection.byModel[0]!.model).toBe('model-b')
  })

  it('orders byModel most expensive first in the wire view', async () => {
    const { ctx, session } = await harness()
    settle(session, { inputTokens: 1000, outputTokens: 0 }, 1, 1, 'priced', 'model-a') // 0.001
    settle(session, { inputTokens: 1000, outputTokens: 0 }, 1, 2, 'priced', 'model-b') // 0.004
    const projection = projected(ctx, session)
    expect(projection.byModel.map(row => row.model)).toEqual(['model-b', 'model-a'])
  })
})
