/**
 * Pure client-safe cost-projection vocabulary.
 *
 * @module @deepseek-ai/dsh-cost-meter/projection
 */

/** One provider/model route's accumulated cost within the current session log. */
export interface CostModelRow {
  readonly provider: string
  readonly model: string
  /** Session-total USD cost for this route, catalog-priced. */
  readonly costUsd: number
  /** Assistant settlements billed on this route. */
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** 0 when the provider never reported the bucket. */
  readonly cacheReadTokens: number
  /** 0 when the provider never reported the bucket. */
  readonly cacheWriteTokens: number
}

/**
 * Durable cumulative catalog-priced API cost for a complete session log.
 *
 * Costs are derived from provider-reported token usage times the installed
 * pi-ai catalog rates (USD per 1M tokens); retried attempts replace the
 * failed attempt's sample instead of double-counting it. Estimates only —
 * the harness never reads provider-reported spend.
 */
export interface CostUsageProjection {
  /** Session-total USD across all priced attempts. */
  readonly totalCostUsd: number
  /** Assistant settlements that reported usage and a model route. */
  readonly attempts: number
  /** Attempts whose model had no catalog price; their cost is 0. */
  readonly unpricedAttempts: number
  /** Per-route rows, most expensive first. */
  readonly byModel: readonly CostModelRow[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Catalog-priced API cost accumulated across the complete durable log. */
    costUsage: CostUsageProjection
  }
}