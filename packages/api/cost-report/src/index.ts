/**
 * Host Remote owner for the global cost report: ledger aggregates by day,
 * workspace (cwd), provider/model route, and session — plus the workspace and
 * route catalogs the panel's filters read and the daily USD→BRL rates of its
 * currency toggle — over the generated `costReport` namespace. All reads are projections of the SQLite ledger the cost meter
 * maintains, so they survive restarts and never measure on demand.
 *
 * @module @deepseek-ai/dsh-api-cost-report
 */

import { Context } from '@deepseek-ai/cordis'
import type { CostMeter } from '@deepseek-ai/dsh-cost-meter'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CostReportModelRow, CostReportRequest, CostReportRow, UsdBrlRate, UsdBrlRatesRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `costReport` Remote namespace. */
    costReportService: CostReportService
  }
}

/**
 * Host service backing the generated `ctx.remote.costReport` namespace. The
 * namespace stays registered when the meter is absent so calls return the
 * actionable missing-service diagnostic rather than a protocol failure.
 */
export class CostReportService extends TypertRemoteService {
  /**
   * @param ctx - Host context where the cost meter may be mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'costReportService', { namespace: 'costReport' })
  }

  /**
   * Aggregate the cost ledger into one bucket, scoped by an optional inclusive
   * filter. Ascending by day; otherwise most expensive first.
   * @param request - bucket group plus optional scoping filter.
   * @returns one row per bucket that priced a settlement.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  report(request: CostReportRequest): CostReportRow[] {
    return this.meter().report(request.group, request.filter)
  }

  /**
   * Session roots (header cwds) that have settled events, ascending.
   * @returns the workspace roots the panel offers as a filter.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  workspaces(): string[] {
    return this.meter().workspaces()
  }

  /**
   * Routes that have settled events, by provider then model.
   * @returns the routes the panel offers as a filter.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  models(): CostReportModelRow[] {
    return this.meter().models()
  }

  /**
   * USD→BRL rate of every calendar day in a range, from the Central Bank of
   * Brazil's PTAX bulletins (cached on disk by the cost meter).
   * @param request - inclusive day range.
   * @returns one row per day with a known rate, ascending; empty offline
   *   before the first successful fetch.
   * @throws RemoteError when no cost meter is mounted.
   */
  @Remote
  async usdBrlRates(request: UsdBrlRatesRequest): Promise<UsdBrlRate[]> {
    return await this.meter().usdBrlRates(request.fromDay, request.toDay)
  }

  /** Resolve the optional cost meter or report how to supply it. */
  private meter(): CostMeter {
    const meter = this.ctx.get('costMeter')
    if (meter === undefined) {
      throw new RemoteError(
        'costReport/unavailable',
        'cost meter service is absent: mount @deepseek-ai/dsh-cost-meter in the profile composition',
        {},
      )
    }
    return meter
  }
}

export default CostReportService
