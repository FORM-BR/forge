---
description: "Browser-side global cost report: registers the Costs panel in the sidebar panel list, reads day/session ledger aggregates over ctx.remote.costReport, filters by period, workspace root, and model, and exposes a costReportNavigation shortcut the chat cost pill uses to open it."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cost-report

English | [中文](README.zh.md)

The panel is a read-only browser surface; it never writes to the ledger or changes model context.

## Summary

The ui-cost-report plugin registers the global Costs panel in the sidebar panel list. The panel reads day and session aggregates over the injected `ctx.remote.costReport` namespace, lets the user filter by period, workspace root, and model, and shows total cost, attempt and token counts, a daily cost trend, and a session drill-down. It also exposes a `costReportNavigation` shortcut that the chat cost pill uses to open the panel directly. Amounts come from the cost meter's local price catalog and are informational, not an invoice.

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

The plugin contributes to two slots: a `sidebar.panellist` icon row and the root-scoped `main` Costs panel it selects. Mount it in the web profile alongside the cost-report Remote BFF and the cost meter for a populated report.

### Panel entry

The sidebar shows a Costs icon whose label comes from the registered locale. Selecting the row opens the `main` panel, which loads its data on first open. With no cost meter mounted, the panel shows the typed `costReport/unavailable` diagnostic with a retry action instead of an empty table.

### Filters and drill-down

The header filters bound the report by period (`fromDay`/`toDay`), workspace root (`cwd`), and provider/model route. The workspace and model dropdowns come from the namespace's own catalogs, so each option filters to a non-empty result. The panel renders a daily-cost trend and a session list for each day; session rows that open a new day bucket are the drill-down, with long session ids truncated for readability.

### Opening from the chat cost pill

The plugin provides `costReportNavigation`, an optional navigation service the chat client reads. The chat cost pill's "Costs report" action calls its `open()` to close the dialog and select the Costs panel. The service lives exactly as long as the panel registration, so an unmounted panel also unmounts the shortcut.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers the `main` slot for the panel and a `sidebar.panellist` row, binds the `costReport` locale namespace, and injects the `costReport` Remote service via the bridge-generated client. The injected face wraps each `ctx.remote.costReport` method and turns an unsuccessful result into a descriptive local error. The store is a per-instance snapshot store created in the generator and shared through the registration's store handle, so remounts keep the current selection and filter. `costReportNavigation` is provided through the optional-service pattern: the provider closure resolves the panel id and disposes the shortcut when the registration makes way.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the Host services this panel reads and the navigation surface it plugs into.

- [cost-report](../../api/cost-report/README.md) — the Remote BFF serving the `ctx.remote.costReport` namespace.
- [cost-meter](../../llm/cost-meter/README.md) — the replay-aware meter maintaining the SQLite ledger behind the reads.
- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the panel list row.
- [Optional services standard](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) — the seam pattern the navigation shortcut follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; the panel assembles no provider request and changes no model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints; they bound what the panel v1 does and what it defers.

- **Panel-only consumption** — v1 ships the visual report only; there is no CLI or export command.
- **Estimates, not an invoice** — amounts come from the cost meter's local price catalog and are informational only.
- **Settlements land on the next load** — the ledger is mirrored asynchronously, so a just-settled event appears after the panel next reads.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The owned relationships — the panel registration, its store, and the navigation shortcut's lifecycle — are asserted by the assembly tests that mount and dispose the plugin fiber.