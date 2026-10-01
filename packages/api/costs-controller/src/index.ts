/**
 * Host Remote owner for the catalog-priced API cost history: reads the
 * SQLite ledger aggregates (`ctx.costMeter.byDay` / `byModel`) over the
 * generated `costs` namespace. The current session's cost surface rides the
 * `costUsage` session projection instead — a browser reads it through
 * `useProjection` without a round trip, so this namespace carries only the
 * cross-session history.
 *
 * @module @deepseek-ai/dsh-api-costs-controller
 */

import { Context } from '@deepseek-ai/cordis'
import type { CostAggregateRow, CostMeter } from '@deepseek-ai/dsh-cost-meter'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CostsDayRow, CostsModelRow } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `costs` Remote namespace. */
    costsController: CostsController
  }
}

/** One aggregate ledger bucket, projected onto its browser-safe wire shape. */
function aggregateView(row: CostAggregateRow): {
  readonly costUsd: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
} {
  return {
    costUsd: row.costUsd,
    attempts: row.attempts,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  }
}

/**
 * Host service backing the generated `ctx.remote.costs` namespace. Both
 * reads are projections of the SQLite ledger the cost meter maintains, so
 * they survive restarts and never measure on demand.
 */
export class CostsController extends TypertRemoteService {
  /**
   * Register the namespace beside the cost meter. The namespace stays
   * registered when the meter is absent so calls return the actionable
   * missing-service diagnostic rather than a protocol failure.
   * @param ctx - Host context where the cost meter may be mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'costsController', { namespace: 'costs' })
  }

  /**
   * Daily cost totals across all sessions, ascending by day (oldest first).
   * @returns one row per local calendar day that priced a settlement.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  byDay(): CostsDayRow[] {
    return this.meter().byDay().map(({ day, ...rest }) => ({ day, ...aggregateView(rest) }))
  }

  /**
   * Per provider/model route cost totals across all sessions, most expensive
   * first.
   * @returns one row per routed model that priced a settlement.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  byModel(): CostsModelRow[] {
    return this.meter().byModel().map(({ provider, model, ...rest }) => ({
      provider,
      model,
      ...aggregateView(rest),
    }))
  }

  /** Resolve the optional cost meter or report how to supply it. */
  private meter(): CostMeter {
    const meter = this.ctx.get('costMeter')
    if (meter === undefined) {
      throw new RemoteError(
        'costs/unavailable',
        'cost meter service is absent: mount @deepseek-ai/dsh-cost-meter in the profile composition',
        {},
      )
    }
    return meter
  }
}

export default CostsController