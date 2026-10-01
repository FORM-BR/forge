---
description: "Replay-aware API cost meter service (ctx.costMeter): prices durable assistant settlements against the pi-ai catalog plus cached OpenRouter rates, exposes the current session's cost as the costUsage session projection, and mirrors every priced settlement into a SQLite ledger under the user home."
kind: "package-reference"
---

# @deepseek-ai/dsh-cost-meter

English | [中文](README.zh.md)

The meter observes the durable session log; it runs during Host startup and never changes a provider request.

## Summary

The cost meter prices durable assistant settlements that report provider usage, using the installed pi-ai catalog rates (USD per 1M tokens) composed with cached OpenRouter prices, and exposes the current session's cost as the `costUsage` session projection. Every priced settlement is mirrored into a SQLite ledger under the user home (`~/.dsh/statistics/costs.sqlite`) so aggregate history by day, provider/model, session root, and session survives restarts. Measurement replays the durable session log, is deterministic, and makes no model calls. A warm-sync pass reconciles stored sessions with the live lookup on startup and is idempotent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service in a profile composition to price API usage across sessions. It registers the `costMeter` service, a session projection, and the warm-sync sweep; consumers read it through `ctx.costMeter`.

### Session cost projection

Pricing happens as an observer of the session stream: each session earns a lazy cell the first time something reads it, and the fold replays that session's durable log through the live lookup. `costUsage` reports total cost, attempt count, unpriced attempts, and per-route cost sorted by most expensive first. Because the projection registry materializes each session once, the meter seeds its price cache from disk before any fold runs, so historical settlements are not frozen as unpriced.

### Durable ledger

Every priced settlement is upserted into the SQLite ledger at `~/.dsh/statistics/costs.sqlite` (configurable), keyed by (session id, event seq). Aggregations group that history by day, by provider/model route, by session root, and by session through the `costMeter` read surface (`byDay()`, `byModel()`, `report()`), which the cost-report Remote BFF and the browser costs panel consume.

### Warm-sync reconciliation

On startup the meter replays the stored sessions under `~/.dsh/sessions` (configurable) through the live price lookup and upserts one settlement per priced event. The upsert key makes a rerun idempotent — re-processing an event overwrites its row, never double counts — and failures such as being offline or a missing sessions root are absorbed. Use `:memory:` as the ledger path only for tests.

### Configuration

`ledgerPath` (default `~/.dsh/statistics/costs.sqlite`, `:memory:` for tests), `priceCachePath` (default `~/.dsh/statistics/openrouter-prices.json`), `priceCacheTtlMs` (default 24 hours), `warmSync` (default `true`), and `sessionsRoot` (default `~/.dsh/sessions`). Unknown keys are rejected loudly so a misspelled option cannot hide behind a default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service composes a price lookup from the on-disk OpenRouter table and the installed pi-ai catalog, registers the `costUsageProjectionDefinition`, and mirrors settlements through `CostLedger` on `node:sqlite` — the only driver the repo ships, so rows are one event each. The synchronous driver blocks the event loop for the duration of each single-statement call, matching the repo-accepted storage-sqlite pattern. Replay state lives per session in a `WeakMap` so unread sessions carry no state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the consumers of the ledger and the projection registry the meter registers into.

- [cost-report](../../api/cost-report/README.md) — the Remote BFF that serves the ledger aggregates to the browser costs panel.
- [ui-cost-report](../../client/ui-cost-report/README.md) — the browser Costs panel that renders the report.
- [session-projection](../../session/session-projection/README.md) — the projection registry the `costUsage` cell registers into.

-----

<a id="model-experience"></a>
## Model Experience

None, as the meter only prices already-logged settlements against local price catalogs and makes no model calls.

#### KV Cache effect

None; the meter folds provider-reported usage and never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints; they define what the meter owns versus what its consumers own.

- **Estimated, not billed** — amounts come from the local price catalog and cached OpenRouter rates; they are informational, not an invoice.
- **Unpriced routes fold as zero-cost rows** — a settlement whose provider route has no catalog or table price still lands in the ledger with an unpriced flag so the report can point it out.
- **The ledger mirrors the durable log** — replay overwrites a row by (session id, seq); the session log remains the source of truth and the ledger a derived projection.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Each ledger row is derived from the durable session log by the same replay fold this package's tests assert, so an invariant check would re-describe the measured code path.