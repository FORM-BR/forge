/**
 * OpenRouter cost backfill: replay stored durable sessions, price every
 * assistant settlement against the same lookup the live meter uses (live
 * OpenRouter prices, then the pi-ai catalog), and upsert one row per event
 * into the SQLite cost ledger.
 *
 * The ledger keys rows by (session id, event seq) with an upsert, so running
 * the backfill twice — dry-run or applied — never double counts an event;
 * this is the idempotence contract the script relies on.
 *
 * @module @deepseek-ai/dsh-cost-meter/backfill
 */

import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { costAttemptOf, isBilledSettlement } from './cost-projection.ts'
import type { CostAttempt } from './cost-projection.ts'
import { CostLedger, dayOf } from './ledger.ts'
import type { PriceLookup } from './rates.ts'

/** One priced settlement collected by the backfill. */
export interface BackfillSettlement {
  readonly sessionId: string
  readonly seq: number
  readonly day: string
  readonly time: number
  readonly provider: string
  readonly model: string
  readonly costUsd: number
  readonly unpriced: boolean
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Session root (header cwd), when the stored header carried one. */
  readonly cwd?: string
  /** Whether the settlement carries an OpenRouter generation id on the event. */
  readonly hasGenerationId: boolean
  /** Whether `costUsd` is the provider-billed amount rather than a catalog estimate. */
  readonly billed: boolean
}

/** Per-route totals reported by a backfill run. */
export interface BackfillRouteTotal {
  readonly provider: string
  readonly model: string
  readonly attempts: number
  readonly unpriced: number
  readonly costUsd: number
}

/** Result of a backfill run, regardless of `apply`: always a full dry summary. */
export interface BackfillResult {
  readonly sessions: number
  readonly settleableEvents: number
  readonly pricedEvents: number
  readonly unpricedEvents: number
  readonly totalCostUsd: number
  readonly sessionsFailed: number
  /** Sum of all settlements; `settleableEvents` minus rows with a generation id. */
  readonly byModel: readonly BackfillRouteTotal[]
}

/** Settings for {@link backfillOpenRouter}. */
export interface BackfillOptions {
  /** `~/.dsh/sessions`-style root that stores session artifacts. */
  readonly sessionsRoot: string
  /** SQLite ledger path (`:memory:` supported for tests). */
  readonly ledgerPath: string
  /** Route price lookup; build it like the live meter (or inject for tests). */
  readonly price: PriceLookup
  /** Whether rows are written to the ledger; `false` reports only. */
  readonly apply: boolean
}

/** Read the durable events of one stored session, or `undefined` on failure. */
async function readSessionEvents(
  persistence: JsonlSessionPersistence,
  id: string,
): Promise<readonly SessionEvent[] | undefined> {
  try {
    const handle = await persistence.open(id as never, 'read')
    try {
      const result = await handle.read()
      return result.events
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

/**
 * The OpenRouter generation id carried on the event, when the provider
 * adapter stored one. The replay envelope halves are opaque to the harness,
 * so this narrows an unknown response object for the pi-ai convention
 * (`response.responseId` prefixed `gen-`).
 */
function generationIdOf(event: SessionEvent): string | undefined {
  if (event.type !== 'assistant/message') return undefined
  const source = event.data.message?.source
  if (source?.kind !== 'model') return undefined
  const replayState = source.replayState
  if (typeof replayState !== 'object' || replayState === null || !('response' in replayState)) return undefined
  const response = replayState.response
  if (typeof response !== 'object' || response === null || !('responseId' in response)) return undefined
  const responseId = response.responseId
  if (typeof responseId !== 'string' || !responseId.startsWith('gen-')) return undefined
  return responseId
}

/** Extract one priced settlement from an event, when one exists. */
function settlementOf(event: SessionEvent, sessionId: string, cwd: string | undefined, attempt: CostAttempt): BackfillSettlement {
  return {
    sessionId,
    seq: event.seq,
    day: dayOf(event.time),
    time: event.time,
    provider: attempt.provider,
    model: attempt.model,
    costUsd: attempt.costUsd,
    unpriced: attempt.unpriced,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    cacheReadTokens: attempt.cacheReadTokens,
    cacheWriteTokens: attempt.cacheWriteTokens,
    ...(cwd === undefined ? {} : { cwd }),
    hasGenerationId: generationIdOf(event) !== undefined,
    billed: isBilledSettlement(event),
  }
}

function addRoute(total: Map<string, BackfillRouteTotal>, settlement: BackfillSettlement): void {
  const key = `${settlement.provider}\u0000${settlement.model}`
  const existing = total.get(key)
  if (existing === undefined) {
    total.set(key, {
      provider: settlement.provider,
      model: settlement.model,
      attempts: 1,
      unpriced: settlement.unpriced ? 1 : 0,
      costUsd: settlement.costUsd,
    })
    return
  }
  total.set(key, {
    provider: existing.provider,
    model: existing.model,
    attempts: existing.attempts + 1,
    unpriced: existing.unpriced + (settlement.unpriced ? 1 : 0),
    costUsd: existing.costUsd + settlement.costUsd,
  })
}

/**
 * Replay every stored session under {@link BackfillOptions.sessionsRoot} and
 * upsert (apply) or merely report (dry-run) one priced settlement per priced
 * assistant event. The lookup is captured per run, so an offline run resolves
 * only catalog-known routes and reports the rest as unpriced.
 * @returns a full summary of what a run would write.
 */
export async function backfillOpenRouter(options: BackfillOptions): Promise<BackfillResult> {
  const ctx = new Context()
  const ledger = new CostLedger(options.ledgerPath)
  const persistence = new JsonlSessionPersistence(ctx, { root: options.sessionsRoot })
  try {
    const snapshots = await persistence.list()
    const routes = new Map<string, BackfillRouteTotal>()
    let settleable = 0
    let priced = 0
    let unpriced = 0
    let total = 0
    let failed = 0
    for (const snapshot of snapshots) {
      const events = await readSessionEvents(persistence, snapshot.header.id)
      if (events === undefined) {
        failed += 1
        continue
      }
      for (const event of events) {
        const attempt = costAttemptOf(event, options.price)
        if (attempt === undefined) continue
        const settlement = settlementOf(event, snapshot.header.id, snapshot.header.cwd, attempt)
        settleable += 1
        priced += settlement.unpriced ? 0 : 1
        unpriced += settlement.unpriced ? 1 : 0
        total += settlement.costUsd
        addRoute(routes, settlement)
        if (options.apply) ledger.upsert(settlement)
      }
    }
    return {
      sessions: snapshots.length,
      settleableEvents: settleable,
      pricedEvents: priced,
      unpricedEvents: unpriced,
      totalCostUsd: total,
      sessionsFailed: failed,
      byModel: [...routes.values()].sort((left, right) => right.costUsd - left.costUsd),
    }
  } finally {
    ledger.close()
  }
}
