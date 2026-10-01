/**
 * SQLite cost ledger on `node:sqlite` (the only driver the repo ships).
 *
 * One row per priced assistant settlement, keyed by (session id, event seq) so
 * a replay that re-reads a session never double counts: re-processing an event
 * overwrites its row. Aggregations group the durable history by day, by
 * provider/model route, by session root (cwd), and by session, which is what
 * the global cost panel reads.
 *
 * The synchronous driver blocks the event loop for the duration of each
 * single-statement call; rows are one event each, matching the repo-accepted
 * storage-sqlite pattern.
 *
 * @module @deepseek-ai/dsh-cost-meter/ledger
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** One durable priced settlement row. */
export interface CostLedgerRow {
  /** Session durable id. */
  readonly sessionId: string
  /** Durable event seq within the session. */
  readonly seq: number
  /** Local calendar day (YYYY-MM-DD) of the settlement. */
  readonly day: string
  /** Event time, epoch milliseconds. */
  readonly time: number
  readonly provider: string
  readonly model: string
  readonly costUsd: number
  /** 1 when the route had no catalog price. */
  readonly unpriced: boolean
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Session root (header cwd); `undefined` for sessions without one. */
  readonly cwd?: string
}

/** One aggregation row over the ledger. */
export interface CostAggregateRow {
  readonly costUsd: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Prompt tokens served from the provider cache, disjoint from `inputTokens`. */
  readonly cacheReadTokens: number
}

/** Aggregation bucket for {@link CostLedger.report}. */
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
  readonly cacheReadTokens: number
}

/** Local calendar day of an epoch-millisecond timestamp, in the host zone. */
export function dayOf(time: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time))
}

const SCHEMA_VERSION = 2

/** The identity column group of a {@link CostReportGroup}. */
const GROUP_COLUMNS: Record<CostReportGroup, readonly string[]> = {
  day: ['day'],
  cwd: ['cwd'],
  model: ['provider', 'model'],
  session: ['session_id'],
}

/**
 * Descriptive columns of a session bucket: its last active day, its root, and
 * its route when every settlement used one provider/model (NULL otherwise).
 */
const SESSION_DETAIL_COLUMNS = `,
             MAX(day) AS last_day, MAX(cwd) AS session_cwd,
             CASE WHEN COUNT(DISTINCT provider || '/' || model) = 1 THEN MAX(provider) END AS only_provider,
             CASE WHEN COUNT(DISTINCT provider || '/' || model) = 1 THEN MAX(model) END AS only_model`

/**
 * Write-side ledger over one SQLite database. `:memory:` is supported for
 * tests; file databases are created with 0o700 directories and WAL journaling.
 */
export class CostLedger {
  private readonly db: DatabaseSync
  private readonly upsertStatement: import('node:sqlite').StatementSync
  private readonly workspacesStatement: import('node:sqlite').StatementSync
  private readonly modelsStatement: import('node:sqlite').StatementSync

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    }
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        day TEXT NOT NULL,
        time INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        unpriced INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL,
        cwd TEXT,
        PRIMARY KEY (session_id, seq)
      ) STRICT
    `)
    // SQLite has no ADD COLUMN IF NOT EXISTS: inspect and alter once for
    // databases created under SCHEMA_VERSION 1.
    const columns = this.db.prepare('PRAGMA table_info(cost_events)').all() as Array<{ name: string }>
    if (!columns.some(column => column.name === 'cwd')) {
      this.db.exec('ALTER TABLE cost_events ADD COLUMN cwd TEXT')
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS cost_events_day ON cost_events (day)')
    this.db.exec('CREATE INDEX IF NOT EXISTS cost_events_model ON cost_events (provider, model)')
    this.db.exec('CREATE INDEX IF NOT EXISTS cost_events_cwd ON cost_events (cwd)')
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    this.upsertStatement = this.db.prepare(`
      INSERT INTO cost_events (
        session_id, seq, day, time, provider, model, cost_usd, unpriced,
        input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cwd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id, seq) DO UPDATE SET
        day = excluded.day,
        time = excluded.time,
        provider = excluded.provider,
        model = excluded.model,
        cost_usd = excluded.cost_usd,
        unpriced = excluded.unpriced,
        input_tokens = excluded.input_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_write_tokens = excluded.cache_write_tokens,
        output_tokens = excluded.output_tokens,
        cwd = excluded.cwd
    `)
    this.workspacesStatement = this.db.prepare(`
      SELECT DISTINCT cwd FROM cost_events WHERE cwd IS NOT NULL ORDER BY cwd ASC
    `)
    this.modelsStatement = this.db.prepare(`
      SELECT DISTINCT provider, model FROM cost_events ORDER BY provider ASC, model ASC
    `)
  }

  /** Insert or replace the row for one priced settlement. */
  upsert(row: CostLedgerRow): void {
    this.upsertStatement.run(
      row.sessionId,
      row.seq,
      row.day,
      row.time,
      row.provider,
      row.model,
      row.costUsd,
      row.unpriced ? 1 : 0,
      row.inputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.outputTokens,
      row.cwd ?? null,
    )
  }

  /** {@link CostReportFilter} clauses and their bind values, in one pass. */
  private filterClauses(filter: CostReportFilter): { clauses: string[]; values: Array<string | number> } {
    const clauses: string[] = []
    const values: Array<string | number> = []
    const bound = (column: string, value: string): void => {
      clauses.push(`${column} = ?`)
      values.push(value)
    }
    if (filter.fromDay !== undefined) {
      clauses.push('day >= ?')
      values.push(filter.fromDay)
    }
    if (filter.toDay !== undefined) {
      clauses.push('day <= ?')
      values.push(filter.toDay)
    }
    if (filter.cwd !== undefined) bound('cwd', filter.cwd)
    if (filter.provider !== undefined) bound('provider', filter.provider)
    if (filter.model !== undefined) bound('model', filter.model)
    if (filter.sessionId !== undefined) bound('session_id', filter.sessionId)
    return { clauses, values }
  }

  /**
   * Aggregate the ledger into one {@link CostReportGroup} bucket, scoped by
   * an optional inclusive filter. Ascending by day; otherwise most expensive
   * first. Column aliases are snake_case in the driver row.
   */
  report(group: CostReportGroup, filter: CostReportFilter = {}): CostReportRow[] {
    const identity = GROUP_COLUMNS[group]
    const { clauses, values } = this.filterClauses(filter)
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const order = group === 'day' ? 'day ASC' : 'cost_usd DESC'
    const statement = this.db.prepare(`
      SELECT ${identity.join(', ')},
             SUM(cost_usd) AS cost_usd, COUNT(*) AS attempts,
             SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
             SUM(cache_read_tokens) AS cache_read_tokens${group === 'session' ? SESSION_DETAIL_COLUMNS : ''}
      FROM cost_events${where}
      GROUP BY ${identity.join(', ')}
      ORDER BY ${order}
    `)
    const aggregate = (raw: Record<string, unknown>): CostAggregateRow => ({
      costUsd: Number(raw.cost_usd),
      attempts: Number(raw.attempts),
      inputTokens: Number(raw.input_tokens),
      outputTokens: Number(raw.output_tokens),
      cacheReadTokens: Number(raw.cache_read_tokens),
    })
    const rows = statement.all(...values) as Array<Record<string, unknown>>
    const result = rows.map((raw) => {
      const base = aggregate(raw)
      switch (group) {
        case 'day': return { day: String(raw.day), ...base }
        case 'cwd': return { ...(raw.cwd === null ? {} : { cwd: String(raw.cwd) }), ...base }
        case 'model':
          return { provider: String(raw.provider), model: String(raw.model), ...base }
        case 'session': return {
          sessionId: String(raw.session_id),
          day: String(raw.last_day),
          ...(raw.session_cwd === null ? {} : { cwd: String(raw.session_cwd) }),
          ...(raw.only_model === null ? {} : { provider: String(raw.only_provider), model: String(raw.only_model) }),
          ...base,
        }
      }
    })
    return result
  }

  /** Daily totals across all sessions, ascending by day. */
  byDay(): Array<{ day: string } & CostAggregateRow> {
    return this.report('day').map(row => ({
      day: row.day ?? '',
      costUsd: row.costUsd,
      attempts: row.attempts,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
    }))
  }

  /** Per-route totals across all sessions, most expensive first. */
  byModel(): Array<{ provider: string; model: string } & CostAggregateRow> {
    return this.report('model').map(row => ({
      provider: row.provider ?? '',
      model: row.model ?? '',
      costUsd: row.costUsd,
      attempts: row.attempts,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
    }))
  }

  /** Session roots (header cwds) that have settled events, ascending. */
  workspaces(): string[] {
    return (this.workspacesStatement.all() as Array<{ cwd: unknown }>).map(row => String(row.cwd))
  }

  /** Routes that have settled events, by provider then model. */
  models(): Array<{ provider: string; model: string }> {
    return (this.modelsStatement.all() as Array<{ provider: unknown; model: unknown }>).map(row => ({
      provider: String(row.provider),
      model: String(row.model),
    }))
  }

  close(): void {
    this.db.close()
  }
}
