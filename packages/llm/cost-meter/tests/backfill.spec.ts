import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { backfillOpenRouter } from '@deepseek-ai/dsh-cost-meter'
import { CostLedger } from '@deepseek-ai/dsh-cost-meter'
import type { ModelCostRates, PriceLookup } from '@deepseek-ai/dsh-cost-meter/client'

const RATES: ModelCostRates = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 }
const price: PriceLookup = (provider, model) => (
  provider === 'openrouterv1' && model === 'deepseek/deepseek-v4.1-flash' ? RATES : undefined
)

const USAGE: TokenUsage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 200 }

/** One closed turn with a single settled assistant event; returns rows with seqs from `start`. */
function turn(start: number, turnNo: number): SessionEvent[] {
  const message = freezeMessage(createMessage({
    role: 'assistant',
    content: [],
    source: { kind: 'model', provider: 'openrouterv1', model: 'deepseek/deepseek-v4.1-flash' },
  }))
  const user = freezeMessage(createMessage({
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }))
  const time = Date.now()
  return [
    { type: 'turn/start', seq: SessionSeq(start), time: time + start, data: { turn: turnNo } },
    { type: 'step/start', seq: SessionSeq(start + 1), time: time + start + 1, data: { turn: turnNo, step: 1 } },
    {
      type: 'user/message', seq: SessionSeq(start + 2), time: time + start + 2, surfaceOp: 'append',
      data: { id: user.id, role: 'user', content: user.content, source: user.source },
    },
    {
      type: 'assistant/message', seq: SessionSeq(start + 3), time: time + start + 3, surfaceOp: 'append',
      data: {
        turn: turnNo, step: 1, message,
        stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: USAGE } }],
        usage: USAGE,
      },
    },
    { type: 'step/end', seq: SessionSeq(start + 4), time: time + start + 4, data: { turn: turnNo, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(start + 5), time: time + start + 5, data: { turn: turnNo, reason: { kind: 'completed' } } },
  ]
}

/** Materialize one stored session with two settled assistant events under a temp root. */
async function materializeSession(root: string): Promise<string> {
  const ctx = new Context()
  const persistence = new JsonlSessionPersistence(ctx, { root })
  const id = SessionId(`session-${Math.random().toString(36).slice(2)}`)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    cwd: 'C:\\work',
    isSeeded: false,
  }
  const handle = await persistence.create(header)
  await handle.append([...turn(0, 1), ...turn(6, 2)])
  await handle.flush()
  await handle.close()
  return id
}

describe('backfillOpenRouter', () => {
  it('prices every stored settlement and reports per-route totals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cost-backfill-'))
    try {
      await materializeSession(root)
      const result = await backfillOpenRouter({ sessionsRoot: root, ledgerPath: ':memory:', price, apply: false })
      expect(result.sessions).toBe(1)
      expect(result.sessionsFailed).toBe(0)
      expect(result.settleableEvents).toBe(2)
      expect(result.pricedEvents).toBe(2)
      expect(result.unpricedEvents).toBe(0)
      // (1000*1 + 500*0.5 + 200*0.25 + 1000*2)/1M = 0.0033 per event
      expect(result.totalCostUsd).toBeCloseTo(0.0066, 12)
      expect(result.byModel).toHaveLength(1)
      expect(result.byModel[0]).toMatchObject({
        provider: 'openrouterv1',
        model: 'deepseek/deepseek-v4.1-flash',
        attempts: 2,
        unpriced: 0,
        costUsd: 0.0066,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('counts unpriced routes with zero cost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cost-backfill-'))
    try {
      await materializeSession(root)
      const result = await backfillOpenRouter({ sessionsRoot: root, ledgerPath: ':memory:', price: () => undefined, apply: false })
      expect(result.settleableEvents).toBe(2)
      expect(result.pricedEvents).toBe(0)
      expect(result.unpricedEvents).toBe(2)
      expect(result.totalCostUsd).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('dry-run never writes ledger rows; apply writes exactly the priced events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cost-backfill-'))
    const ledgerPath = join(root, 'ledger.sqlite')
    try {
      await materializeSession(root)
      await backfillOpenRouter({ sessionsRoot: root, ledgerPath, price, apply: false })

      const dry = new CostLedger(ledgerPath)
      expect(dry.byModel()).toHaveLength(0)
      expect(dry.byDay()).toHaveLength(0)
      dry.close()

      const applied = await backfillOpenRouter({ sessionsRoot: root, ledgerPath, price, apply: true })
      expect(applied.pricedEvents).toBe(2)

      const after = new CostLedger(ledgerPath)
      const rows = after.byModel()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ provider: 'openrouterv1', attempts: 2, costUsd: 0.0066 })
      expect(after.byDay()).toHaveLength(1)
      expect(after.byDay()[0]!.attempts).toBe(2)
      expect(after.workspaces()).toEqual(['C:\\work'])
      after.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('re-running with apply upserts instead of double counting (idempotence)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cost-backfill-'))
    const ledgerPath = join(root, 'ledger.sqlite')
    try {
      await materializeSession(root)
      const first = await backfillOpenRouter({ sessionsRoot: root, ledgerPath, price, apply: true })
      const second = await backfillOpenRouter({ sessionsRoot: root, ledgerPath, price, apply: true })
      expect(first.totalCostUsd).toBeCloseTo(second.totalCostUsd, 12)

      const ledger = new CostLedger(ledgerPath)
      expect(ledger.byModel()[0]!.attempts).toBe(2)
      expect(ledger.byModel()[0]!.costUsd).toBeCloseTo(0.0066, 12)
      expect(ledger.byDay()[0]!.attempts).toBe(2)
      ledger.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})