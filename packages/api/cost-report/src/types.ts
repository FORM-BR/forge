/**
 * Browser-safe wire types of the generated `costReport` Remote namespace: the
 * ledger report buckets, filters, and catalogs the global cost panel reads.
 * The bucket shapes duplicate the Host-side ledger rows on purpose — the
 * ledger lives behind `node:sqlite` and must never ride a browser bundle.
 *
 * @module @deepseek-ai/dsh-api-cost-report/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The Host answered a cost report read without a mounted `ctx.costMeter`
     * service. The namespace stays registered so the caller can render the
     * actionable diagnostic instead of a protocol failure.
     */
    'costReport/unavailable': {}
  }
}

/** Aggregation bucket for {@link CostReportService.report}. */
export type CostReportGroup = 'day' | 'cwd' | 'model' | 'session'

/** Optional scoping of a ledger report. All bounds are inclusive. */
export interface CostReportFilter {
  /** Include only settlements on or after this day (YYYY-MM-DD). */
  readonly fromDay?: string
  /** Include only settlements on or before this day (YYYY-MM-DD). */
  readonly toDay?: string
  /** Include only settlements from this session root (exact cwd). */
  readonly cwd?: string
  readonly provider?: string
  readonly model?: string
  /** Include only settlements of this session. */
  readonly sessionId?: string
}

/**
 * One bucket of a ledger report. Group identity fields are set per group; a
 * `session` bucket also carries its last active day, its root, and its route
 * when every settlement used a single provider/model.
 */
export interface CostReportRow {
  readonly day?: string
  readonly cwd?: string
  readonly provider?: string
  readonly model?: string
  readonly sessionId?: string
  readonly costUsd: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Prompt tokens served from the provider cache, disjoint from `inputTokens`. */
  readonly cacheReadTokens?: number
  /** The part of `costUsd` the provider billed; the rest is catalog-estimated. */
  readonly billedUsd?: number
}

/** Request of {@link CostReportService.report}: the bucket plus scoping. */
export interface CostReportRequest {
  readonly group: CostReportGroup
  readonly filter?: CostReportFilter
}

/** One provider/model route that has settled events. */
export interface CostReportModelRow {
  readonly provider: string
  readonly model: string
}
