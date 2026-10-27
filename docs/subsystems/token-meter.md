# Token Meter

English | [中文](token-meter.zh.md)

`@deepseek-ai/dsh-token-meter` exposes one detached replay snapshot for request pressure and positional surface pricing. `logRevision` is the number of durable events consumed for every field in the measurement.

Source: [`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

## `TokenMeasurement`

```ts type-equiv
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: SessionLogOffset
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total route-priced request tokens across the current surface; equals the sum of the node prices. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}
```

Every measurement resolves the effective envelope's routed provider/model to that route's declared request-image pricing through `ctx.llm`, so image occurrences are priced as the visual tokens plus model-visible text the request actually sends; routes and compositions without declared pricing keep the fixed heuristic. `baseline.kind === 'usage'` means the latest successful provider call has the same canonical request envelope and its total is no lower than that call's full route-priced anchor. `estimated` means no reusable conservative usage anchor exists, so the service priced the complete envelope and surface itself. A later successful request replaces the earlier anchor; signed `surfaceDeltaTokens` preserves growth and shrinkage relative to a matching anchor, repricing both sides under the same route. `totalTokens` remains request-and-response pressure, while `surfaceTokens` is the surface-only route-priced total and equals the sum of the node prices.

## `TokenSurfaceNode`

```ts type-equiv
/** One token-priced node in the current ordered session surface. */
interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: SessionSeq
  /**
   * Request-pressure tokens for the exact message projected by this node under
   * the measured route: image occurrences carry the route's declared visual
   * price when the routed adapter declares one, and the fixed heuristic
   * otherwise. Trigger, retention, and range selection all read this price.
   */
  readonly tokens: number
  /**
   * Fixed-heuristic tokens for the same message, independent of any route.
   * The shadow-price protocol prices replacements with this value so the O(1)
   * projection fold stays in agreement with its own appends.
   */
  readonly heuristicTokens: number
}
```

Surface order is authoritative; replacement nodes can have higher durable seqs than later positional nodes. The snapshot is immutable and does not grow when the underlying replay fold advances.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcostmeter--costmeter"></a>

### `ctx.costMeter` — `CostMeter`

Host service `ctx.costMeter`: prices every durable assistant settlement with the live OpenRouter table or the installed catalog, folds the current session's cost into the `costUsage` projection, and writes each priced event to the SQLite ledger that backs the history queries below.

```ts cordis-catalog
/**
 * Measure one session's catalog-priced API cost through its durable tail.
 * @param session - session to replay through its current durable log.
 * @returns a detached per-route and total cost projection.
 */
measure(session: Session): CostUsageProjection

/**
 * Daily cost totals across all sessions from the SQLite ledger.
 * @returns one aggregate per calendar day with settled events, ascending by day.
 */
byDay(): Array<{ day: string } & CostAggregateRow>

/**
 * Per-route cost totals across all sessions from the SQLite ledger.
 * @returns one aggregate per provider/model route, most expensive first.
 */
byModel(): Array<{ provider: string; model: string } & CostAggregateRow>

/**
 * Ledger aggregates in one {@link CostReportGroup} bucket, scoped by filter.
 * @param group - bucket to aggregate by: day, session root (cwd), model route, or session.
 * @param filter - optional inclusive bounds (days, cwd, provider, model, session); defaults to the whole ledger.
 * @returns one row per bucket, ascending by day for the `day` group and most expensive first otherwise.
 */
report(group: CostReportGroup, filter: CostReportFilter = {}): CostReportRow[]

/**
 * Session roots with settled events.
 * @returns the distinct session working directories in the ledger, ascending.
 */
workspaces(): string[]

/**
 * USD→BRL rate of every calendar day in an inclusive range (PTAX selling
 * rate of the day, or the latest earlier bulletin).
 * @param fromDay - first day, YYYY-MM-DD.
 * @param toDay - last day, YYYY-MM-DD.
 * @returns one row per day with a known rate, ascending.
 */
usdBrlRates(fromDay: string, toDay: string): Promise<UsdBrlRate[]>

/**
 * Routes with settled events.
 * @returns the distinct provider/model pairs in the ledger, ordered by provider then model.
 */
models(): Array<{ provider: string; model: string }>

/**
 * Replay every stored session under the configured sessions root through
 * the live price lookup and upsert one settlement per priced event. The
 * (session id, seq) upsert key makes re-runs idempotent. Absorbs offline
 * and per-session read failures the same way the CLI backfill does.
 */
async warmSync(): Promise<void>
```

Types: [Session](session.md)

Source: [`packages/llm/cost-meter/src/index.ts`](../../packages/llm/cost-meter/src/index.ts)

<a id="ctxcostreportservice--costreportservice"></a>

### `ctx.costReportService` — `CostReportService`

Host service backing the generated `ctx.remote.costReport` namespace. The namespace stays registered when the meter is absent so calls return the actionable missing-service diagnostic rather than a protocol failure.

```ts cordis-catalog
/**
 * Aggregate the cost ledger into one bucket, scoped by an optional inclusive
 * filter. Ascending by day; otherwise most expensive first.
 * @param request - bucket group plus optional scoping filter.
 * @returns one row per bucket that priced a settlement.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote report(request: CostReportRequest): CostReportRow[]

/**
 * Session roots (header cwds) that have settled events, ascending.
 * @returns the workspace roots the panel offers as a filter.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote workspaces(): string[]

/**
 * Routes that have settled events, by provider then model.
 * @returns the routes the panel offers as a filter.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote models(): CostReportModelRow[]

/**
 * USD→BRL rate of every calendar day in a range, from the Central Bank of
 * Brazil's PTAX bulletins (cached on disk by the cost meter).
 * @param request - inclusive day range.
 * @returns one row per day with a known rate, ascending; empty offline
 *   before the first successful fetch.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote async usdBrlRates(request: UsdBrlRatesRequest): Promise<UsdBrlRate[]>
```

Source: [`packages/api/cost-report/src/index.ts`](../../packages/api/cost-report/src/index.ts)

<a id="ctxcostscontroller--costscontroller"></a>

### `ctx.costsController` — `CostsController`

Host service backing the generated `ctx.remote.costs` namespace. Both reads are projections of the SQLite ledger the cost meter maintains, so they survive restarts and never measure on demand.

```ts cordis-catalog
/**
 * Daily cost totals across all sessions, ascending by day (oldest first).
 * @returns one row per local calendar day that priced a settlement.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote byDay(): CostsDayRow[]

/**
 * Per provider/model route cost totals across all sessions, most expensive
 * first.
 * @returns one row per routed model that priced a settlement.
 * @throws RemoteError when no cost meter is mounted.
 */
@Remote byModel(): CostsModelRow[]
```

Source: [`packages/api/costs-controller/src/index.ts`](../../packages/api/costs-controller/src/index.ts)

<a id="ctxtokenmeter--tokenmeter"></a>

### `ctx.tokenMeter` — `TokenMeter`

Replay owner for one service-wide estimator and isolated per-session folds.

```ts cordis-catalog
/**
 * Measure current request pressure and surface through the durable tail.
 *
 * The effective envelope's routed provider/model selects the request-image
 * pricing every node is priced under: a route whose adapter declares image
 * pricing charges each retained image its visual tokens plus its
 * model-visible text, while other routes keep the fixed heuristic. Provider
 * usage is reused only when the latest successful call's canonical request
 * envelope matches `requestHeader` and its total is no lower than that
 * call's full route-priced anchor; otherwise the complete envelope and
 * surface are repriced. The anchor includes all surface nodes immediately
 * before the assistant message, including inputs admitted after step/start.
 *
 * `requestHeader` replaces the latest logged envelope for pressure and node
 * pricing; the node set always describes the current session surface. Every
 * call clones those positional nodes, so measurement is O(surface).
 *
 * @param session - session to replay through its current durable tail.
 * @param requestHeader - optional effective request envelope replacing the latest logged header.
 * @returns a detached deeply immutable pressure and surface measurement.
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed service heuristic.
 */
estimateMessage(message: Message): number
```

Types: [EpochHeader](session.md) · [Message](llm-streaming.md) · [Session](session.md)

Source: [`packages/llm/token-meter/src/index.ts`](../../packages/llm/token-meter/src/index.ts)
<!-- END GENERATED cordis-surface -->
