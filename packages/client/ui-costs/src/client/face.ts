/** Ledger read model injected into the costs panel seats. */
import type { CostsDayRow, CostsModelRow } from '@deepseek-ai/dsh-api-costs-controller/types'

/**
 * The costs tab's injected commands: the ledger history the panel renders
 * beside the current Session projection. Reads resolve lazily per call so a
 * newly settled attempt is reflected on the next retry.
 */
export interface CostsInjected {
  /** Daily ledger buckets, ascending by local calendar day. */
  readonly byDay: () => Promise<readonly CostsDayRow[]>
  /** Per provider/model route ledger totals, most expensive first. */
  readonly byModel: () => Promise<readonly CostsModelRow[]>
}
