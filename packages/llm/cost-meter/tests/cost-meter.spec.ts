import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CostMeter from '@deepseek-ai/dsh-cost-meter'
import type { CostUsageProjection } from '@deepseek-ai/dsh-cost-meter/client'

const USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 200 }

function settle(
  session: Session,
  usage: TokenUsage,
  turn: number,
  step: number,
  provider = 'openrouter',
  model = 'openai/gpt-4o',
): void {
  session.append('assistant/message', {
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

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function harness(): Promise<{ ctx: Context; session: Session }> {
  // Every service instance seeds its price table from the configured cache
  // path; a per-test directory keeps the host's real price cache out of the
  // fold, so the catalog is the only price source here.
  const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CostMeter, {
    ledgerPath: ':memory:',
    priceCachePath: join(root, 'openrouter-prices.json'),
  })
  return { ctx, session: ctx.sessions.create() }
}

describe('CostMeter service', () => {
  it('measures one session through the projection', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    settle(session, { inputTokens: 500, outputTokens: 500 }, 1, 2)
    const projection = ctx.costMeter.measure(session)
    expect(projection.totalCostUsd).toBeGreaterThan(0)
    expect(projection.attempts).toBe(2)
    expect(projection.byModel).toHaveLength(1)
    expect(projection.byModel[0]!.model).toBe('openai/gpt-4o')
  })

  it('counts retries as a single attempt', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    settle(session, { inputTokens: 2000, outputTokens: 2000 }, 1, 1)
    expect(ctx.costMeter.measure(session).attempts).toBe(1)
  })

  it('serves zero without samples and counts unpriced routes', async () => {
    const { ctx, session } = await harness()
    expect(ctx.costMeter.measure(session)).toEqual({
      totalCostUsd: 0, attempts: 0, unpricedAttempts: 0, byModel: [],
    } satisfies CostUsageProjection)
    settle(session, USAGE, 1, 1, 'no-such-provider', 'no-such-model')
    const projection = ctx.costMeter.measure(session)
    expect(projection.totalCostUsd).toBe(0)
    expect(projection.unpricedAttempts).toBe(1)
  })

  it('mirrors priced settlements into the SQLite ledger aggregates', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1, 'openrouter', 'openai/gpt-4o')
    settle(session, { inputTokens: 1000, outputTokens: 1000 }, 2, 1, 'openrouter', 'anthropic/claude-3-haiku')
    // The ledger is fed by the same _sync pass that folds a session, so settle lazily.
    ctx.costMeter.measure(session)
    expect(ctx.costMeter.byModel()).toHaveLength(2)
    const total = ctx.costMeter.byDay().reduce((sum, entry) => sum + entry.costUsd, 0)
    expect(total).toBeCloseTo(ctx.costMeter.measure(session).totalCostUsd, 12)
  })

  it('replaying the same session does not duplicate ledger rows', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    ctx.costMeter.measure(session)
    ctx.costMeter.measure(session)
    expect(ctx.costMeter.byModel()[0]!.attempts).toBe(1)
    expect(ctx.costMeter.byDay()).toHaveLength(1)
  })

  it('prices an openrouterv1 route from the on-disk cache before the live fetch resolves', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cost-meter-seeded-'))
    roots.push(root)
    const cachePath = join(root, 'openrouter-prices.json')
    writeFileSync(cachePath, JSON.stringify({
      version: 1,
      fetchedAt: Date.now(),
      models: {
        'deepseek/deepseek-v4-flash-latest': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
      },
    }), 'utf8')

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(CostMeter, { ledgerPath: ':memory:', priceCachePath: cachePath })
    const session = ctx.sessions.create()
    settle(session, USAGE, 1, 1, 'openrouterv1', '~deepseek/deepseek-v4-flash-latest')

    const projection = ctx.costMeter.measure(session)
    expect(projection.unpricedAttempts).toBe(0)
    expect(projection.totalCostUsd).toBeGreaterThan(0)
    // The same pass upserts the priced row, so the durable aggregate is priced too.
    expect(ctx.costMeter.byModel()[0]!.costUsd).toBeGreaterThan(0)
  })

  it('records settlements in the ledger without a measure() call', async () => {
    const { ctx, session } = await harness()
    settle(session, USAGE, 1, 1)
    settle(session, { inputTokens: 500, outputTokens: 500 }, 2, 1)
    expect(ctx.costMeter.byDay()[0]!.attempts).toBe(2)
  })

  it('marks billed settlements in the ledger and estimates the rest', async () => {
    const { ctx, session } = await harness()
    settle(session, { ...USAGE, costUsd: 0.25 }, 1, 1)
    settle(session, { inputTokens: 1000, outputTokens: 1000 }, 2, 1)
    const [day] = ctx.costMeter.byDay()
    expect(day!.billedUsd).toBe(0.25)
    expect(day!.costUsd).toBeGreaterThan(0.25)
  })
})
