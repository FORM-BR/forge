/**
 * Single replay-aware API cost meter service (ctx.costMeter).
 *
 * Prices each durable assistant settlement that reports provider usage against
 * the installed pi-ai catalog rates (USD per 1M tokens), exposes the current
 * session's cost as the `costUsage` session projection, and mirrors every
 * priced settlement into a SQLite ledger under the user home so aggregate
 * history (by day, by provider/model) survives restarts. Measurement replays
 * the durable session log, is deterministic, and makes no model calls.
 *
 * @module @deepseek-ai/dsh-cost-meter
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionLogOffset as SessionLogOffsetType } from '@deepseek-ai/dsh-session'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
// Type-only: activates the `ctx.sessionProjections` Context declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
import { costAttemptOf, costUsageProjectionDefinition, foldCostUsage, initCostUsageState, isBilledSettlement } from './cost-projection.ts'
import type { CostUsageState } from './cost-projection.ts'
import type { CostUsageProjection } from './projection.ts'
import { CostLedger, dayOf } from './ledger.ts'
import type { CostAggregateRow, CostReportFilter, CostReportGroup, CostReportRow } from './ledger.ts'
import { backfillOpenRouter } from './backfill.ts'
import type { PriceLookup } from './rates.ts'
import { catalogPriceLookup } from './pricing.ts'
import { composePriceLookup, OpenRouterPriceTable, DEFAULT_PRICE_CACHE_TTL_MS } from './openrouter.ts'

export type * from './projection.ts'
// Module-edge re-export: forces the emitted index.d.ts to import the
// projection-unit module, so its SessionProjectionStateMap augmentation loads
// in aggregate programs that only import the package root.
export type * from './cost-projection.ts'
// Runtime faces of the fold: the host registers the definition; tests and CLI
// consumers fold directly.
export { costUsageProjectionDefinition, foldCostUsage, initCostUsageState } from './cost-projection.ts'
// Offline backfill surface: replays stored sessions and prices them against the
// same lookup, upserting one row per event into the ledger (idempotent).
export { backfillOpenRouter } from './backfill.ts'
export type { BackfillOptions, BackfillResult, BackfillRouteTotal, BackfillSettlement } from './backfill.ts'
// Ledger runtime face: the backfill upserts into it and consumers read
// aggregates; also the seam re-exported for host/CLI callers.
export { CostLedger, dayOf } from './ledger.ts'

/** Public settings surface; only the ledger location and price cache are configurable. */
export interface CostMeterConfig {
  /**
   * SQLite ledger path. Defaults to `~/.dsh/statistics/costs.sqlite`;
   * `:memory:` is supported for tests.
   */
  readonly ledgerPath?: string
  /** On-disk OpenRouter price cache. Defaults to `~/.dsh/statistics/openrouter-prices.json`. */
  readonly priceCachePath?: string
  /** OpenRouter price freshness window in milliseconds. Defaults to 24 hours. */
  readonly priceCacheTtlMs?: number
  /**
   * Replay stored sessions through the live price lookup on service start and
   * upsert one settlement per priced event (idempotent, never double counts).
   * Defaults to `true`.
   */
  readonly warmSync?: boolean
  /** `~/.dsh/sessions`-style root the warm sync replays. Defaults to `~/.dsh/sessions`. */
  readonly sessionsRoot?: string
}

const CONFIG_KEYS = new Set(['ledgerPath', 'priceCachePath', 'priceCacheTtlMs', 'warmSync', 'sessionsRoot'])

/** Reject stale or misspelled keys before defaults can hide them. */
function validateConfigKeys(config: CostMeterConfig): void {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `CostMeterConfig: unknown key "${key}" (only "ledgerPath", "priceCachePath", "priceCacheTtlMs", "warmSync" and "sessionsRoot" are supported)`,
      )
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    costMeter: CostMeter
  }
}

interface ReplayEntry {
  consumed: SessionLogOffsetType
  state: CostUsageState
}

/** One aggregate history bucket the ledger returns; re-exported for the API seam. */
export type { CostAggregateRow }
// Ledger report surface: buckets (day/cwd/model/session) and their filters,
// re-exported so the API seam and CLI consumers share the same shapes.
export type { CostReportFilter, CostReportGroup, CostReportRow } from './ledger.ts'

export class CostMeter extends Service {
  // Schemastery has no `.optional()`; a defaulted `''` means "use the home
  // path", letting the loader accept an absent ledgerPath. Unknown loader keys
  // are preserved by the object schema; the public type excludes them while
  // validateConfigKeys rejects them.
  static Config: z<CostMeterConfig> = z.object({
    ledgerPath: z.string().default(''),
    priceCachePath: z.string().default(''),
    priceCacheTtlMs: z.number().min(0).default(DEFAULT_PRICE_CACHE_TTL_MS),
    warmSync: z.boolean().default(true),
    sessionsRoot: z.string().default(''),
  }) as unknown as z<CostMeterConfig>

  static inject = ['sessionProjections']

  private readonly states = new WeakMap<Session, ReplayEntry>()
  private readonly price: PriceLookup
  private readonly ledger: CostLedger
  private readonly openRouterPrices: OpenRouterPriceTable
  private readonly config: CostMeterConfig

  constructor(ctx: Context, config: CostMeterConfig = {}) {
    super(ctx, 'costMeter')
    validateConfigKeys(config)
    this.config = config

    this.openRouterPrices = new OpenRouterPriceTable({
      ...(config.priceCachePath !== undefined && config.priceCachePath !== ''
        ? { cachePath: config.priceCachePath }
        : {}),
      ...(config.priceCacheTtlMs !== undefined ? { ttlMs: config.priceCacheTtlMs } : {}),
    })
    // Live OpenRouter prices first (the profile's `${provider}` routes), then
    // the installed pi-ai catalog for every other provider.
    this.price = composePriceLookup(this.openRouterPrices.asPriceLookup(), catalogPriceLookup())
    this.ledger = new CostLedger(this.ledgerPath())

    // Seed from the on-disk cache before anything can fold history. The
    // projection registry materializes one cell per session at its first read
    // and never re-folds it, so a fold that starts on an empty table freezes
    // every historical settlement of that session as unpriced.
    this.openRouterPrices.loadDiskCache()

    ctx.sessionProjections.register(costUsageProjectionDefinition(this.price))

    // Warm-sync: reconcile the durable ledger with the stored sessions through
    // the live lookup, without blocking startup. The upsert key makes a rerun
    // idempotent; failures (offline, missing sessions root) are absorbed. An
    // in-memory ledger is test scaffolding, never a real reconciliation.
    if (this.config.warmSync !== false && this.ledgerPath() !== ':memory:') {
      void this.warmSync()
    }

    // Warm the price table without blocking service startup; a failed or
    // offline fetch leaves the table empty and routes read as unpriced.
    void this.openRouterPrices.ensureLoaded()

    // Every durable event reaches the ledger as it lands, whether or not a
    // consumer has read the session's cost; the first event of a session
    // replays its earlier history once, and the upsert key keeps that
    // idempotent with the warm sync.
    ctx.on('session/event', (session) => {
      this._sync(session)
    })

    // Close the SQLite ledger when the service scope tears down.
    ctx.effect(() => () => {
      this.ledger.close()
    })
  }

  /**
   * Measure one session's catalog-priced API cost through its durable tail.
   * @param session - session to replay through its current durable log.
   * @returns a detached per-route and total cost projection.
   */
  measure(session: Session): CostUsageProjection {
    const entry = this._sync(session)
    return viewOf(entry.state)
  }

  /** Daily cost totals across all sessions from the SQLite ledger. */
  byDay(): Array<{ day: string } & CostAggregateRow> {
    return this.ledger.byDay()
  }

  /** Per-route cost totals across all sessions from the SQLite ledger. */
  byModel(): Array<{ provider: string; model: string } & CostAggregateRow> {
    return this.ledger.byModel()
  }

  /** Ledger aggregates in one {@link CostReportGroup} bucket, scoped by filter. */
  report(group: CostReportGroup, filter: CostReportFilter = {}): CostReportRow[] {
    return this.ledger.report(group, filter)
  }

  /** Session roots with settled events, ascending. */
  workspaces(): string[] {
    return this.ledger.workspaces()
  }

  /** Routes with settled events, by provider then model. */
  models(): Array<{ provider: string; model: string }> {
    return this.ledger.models()
  }

  /**
   * Replay every stored session under the configured sessions root through
   * the live price lookup and upsert one settlement per priced event. The
   * (session id, seq) upsert key makes re-runs idempotent. Absorbs offline
   * and per-session read failures the same way the CLI backfill does.
   */
  async warmSync(): Promise<void> {
    try {
      const result = await backfillOpenRouter({
        sessionsRoot: this.sessionsRoot(),
        ledgerPath: this.ledgerPath(),
        price: this.price,
        apply: true,
      })
      if (result.sessionsFailed > 0) {
        this.ctx.logger.warn(`cost-meter: warm sync skipped ${result.sessionsFailed} unreadable session(s)`)
      }
    } catch (error) {
      // Warm-sync is best effort: it must never take the meter (or the host)
      // down. A later boot retries the reconciliation; the warning keeps a
      // ledger that stopped filling diagnosable.
      this.ctx.logger.warn('cost-meter: warm sync failed', error)
    }
  }

  /**
   * The SQLite ledger location. The loader defaults absent path settings to
   * `''`, so both `undefined` and `''` select the home default.
   */
  private ledgerPath(): string {
    const configured = this.config.ledgerPath
    return configured === undefined || configured === '' ? dshHomePath('statistics', 'costs.sqlite') : configured
  }

  /** The stored-sessions root the warm sync replays; `''` selects the home default. */
  private sessionsRoot(): string {
    const configured = this.config.sessionsRoot
    return configured === undefined || configured === '' ? dshHomePath('sessions') : configured
  }

  /** Catch one session's fold up to the current durable tail. */
  private _sync(session: Session): ReplayEntry {
    let entry = this.states.get(session)
    if (entry === undefined) {
      entry = { consumed: SessionLogOffset(0), state: initCostUsageState() }
      this.states.set(session, entry)
    }

    while (entry.consumed < session.seq) {
      // Contiguous session seqs index the durable log; existing Session history read, migration deferred.
      // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
      const event = session.eventAt(SessionSeq(entry.consumed))!
      entry.state = foldCostUsage(entry.state, event, this.price)
      const attempt = costAttemptOf(event, this.price)
      if (attempt !== undefined) {
        this.ledger.upsert({
          sessionId: session.id,
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
          ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
          billed: isBilledSettlement(event),
        })
      }
      entry.consumed = SessionLogOffset(entry.consumed + 1)
    }
    return entry
  }
}

/** The wire view over a fold state: most expensive route first. */
function viewOf(state: CostUsageState): CostUsageProjection {
  return {
    totalCostUsd: state.totalCostUsd,
    attempts: state.attempts,
    unpricedAttempts: state.unpricedAttempts,
    byModel: [...state.byModel].sort((left, right) => right.costUsd - left.costUsd),
  }
}

export default CostMeter
