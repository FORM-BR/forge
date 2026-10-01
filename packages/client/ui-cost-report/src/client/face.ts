/**
 * Ledger read model injected into the cost report panel. Reads resolve lazily
 * per call so a newly settled attempt is reflected on the next load.
 */
import type {
  CostReportFilter, CostReportGroup, CostReportModelRow, CostReportRow,
} from '@deepseek-ai/dsh-api-cost-report/types'

/**
 * The report panel's injected commands: the ledger aggregates and the filter
 * catalogs the Host projects over the SQLite cost ledger.
 */
export interface CostReportInjected {
  /** Ledger buckets for one group, scoped by the inclusive filter. */
  report: (group: CostReportGroup, filter: CostReportFilter) => Promise<readonly CostReportRow[]>
  /** Session roots (header cwds) that have settled events, ascending. */
  workspaces: () => Promise<readonly string[]>
  /** Provider/model routes that have settled events, by provider then model. */
  models: () => Promise<readonly CostReportModelRow[]>
}