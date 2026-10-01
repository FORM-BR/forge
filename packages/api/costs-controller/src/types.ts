/**
 * Browser-safe wire types of the generated `costs` Remote namespace: the
 * ledger aggregates the cost panel reads. The shapes duplicate the Host-side
 * `CostAggregateRow` on purpose — the ledger lives behind `node:sqlite` and
 * must never ride a browser bundle.
 *
 * @module @deepseek-ai/dsh-api-costs-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The Host answered a costs read without a mounted `ctx.costMeter`
     * service. The namespace stays registered so the caller can render the
     * actionable diagnostic instead of a protocol failure.
     */
    'costs/unavailable': {}
  }
}

/** One daily ledger bucket, ascending by day. */
export interface CostsDayRow {
  /** Local calendar day (YYYY-MM-DD) of the settlements, in the Host zone. */
  readonly day: string
  /** Catalog-priced cost in USD for the day. */
  readonly costUsd: number
  /** Number of priced assistant settlements on the day. */
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** One provider/model route bucket, most expensive first. */
export interface CostsModelRow {
  readonly provider: string
  readonly model: string
  readonly costUsd: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
}