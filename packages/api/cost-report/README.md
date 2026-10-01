---
description: "Host Remote owner of the global cost report: serves day, workspace (cwd), provider/model-route, and session aggregates of the cost meter's SQLite ledger — plus workspace and route catalogs — over the generated costReport namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-cost-report

English | [中文](README.zh.md)

The Remote BFF runs in the Host process and serves read-only projections; it never prices or measures on demand.

## Summary

The cost-report Remote BFF presents the global cost panel's data as a Typert namespace (`costReport`). Its methods project the SQLite ledger the cost meter maintains into day, workspace-root, provider/model-route, and session buckets with an inclusive optional filter, and enumerate the workspaces and routes the panel's filters offer. The wire bucket shapes duplicate the Host ledger rows on purpose, so the ledger's `node:sqlite` dependency never rides a browser bundle. When no cost meter is mounted the namespace stays registered and returns the actionable `costReport/unavailable` diagnostic instead of a protocol failure.

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

Mount the service in the profile composition to expose the cost ledger to the browser. Consumers call the generated `ctx.remote.costReport` namespace; the panel renders the report, and this package answers.

### Report buckets

`report({ group, filter })` aggregates the ledger into one bucket row per settlement-bearing bucket. Groups are `day`, `cwd` (session root), `model` (provider/model route), and `session`; the inclusive `filter` scopes by `fromDay`/`toDay`, `cwd`, `provider`, `model`, and `sessionId`. Rows sort ascending by day, otherwise most expensive first, so the panel's default view shows the largest spenders.

### Workspace and route catalogs

`workspaces()` returns the session roots that have settled events, ascending, and `models()` returns the provider/model routes, by provider then model. The panel builds its filter dropdowns from these catalogs, so every option offered filters to a non-empty result.

### Absent meter

Reads require the cost meter service. When `ctx.costMeter` is not mounted, every read throws the typed `costReport/unavailable` RemoteError whose message tells the operator to mount `@deepseek-ai/dsh-cost-meter` in the profile composition — the panel surfaces that guidance instead of a silent empty report.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`CostReportService` extends `TypertRemoteService` with the `costReport` namespace and forwards each method to the resolved cost meter. `meter()` reads `ctx.get('costMeter')` and throws the actionable RemoteError when it is absent; because the service itself stays mounted, the namespace never drops out of the generated client, so the browser always gets a typed, presentable failure. `src/types.ts` holds only the browser-safe wire declarations — no runtime code — and duplicates the Host ledger shapes deliberately, keeping `node:sqlite` out of every browser bundle.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the ledger's owner and the panel that consumes this namespace.

- [cost-meter](../../llm/cost-meter/README.md) — the replay-aware meter that maintains the SQLite ledger behind these reads.
- [ui-cost-report](../../client/ui-cost-report/README.md) — the browser Costs panel that renders the report and filters.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only serves read-only ledger projections to the browser costs panel and registers no prompt, tool, or session event.

#### KV Cache effect

None; the service resolves headless ledger reads and never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints; they define what the BFF owns versus what its neighbors own.

- **Read-only delivery** — v1 exposes aggregation reads only; writing or backfilling the ledger belongs to the cost meter.
- **Wire shapes duplicate the ledger by contract** — the browser-safe bucket types mirror the Host ledger rows; the two sides must be kept in step when the model's cost surfaces change.
- **Absent meter fails loud** — an unmounted cost meter surfaces as `costReport/unavailable` rather than an empty report, which is the intended diagnostic.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The only owned relationship — the namespace owner mapping — is declared in the service annotation and exercised by this package's Remote tests, so an independent check would re-describe the same code path.