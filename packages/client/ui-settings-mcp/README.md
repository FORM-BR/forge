---
description: "Read-only MCP servers tab in Web Plugins settings for the dsh web client: connection state, transport, endpoint host, tool count, and the last error of every configured MCP server, with an empty state that shows where to configure one."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

## Summary

The **MCP servers** tab lets Web users see which MCP servers are plugged in and whether they work. Each server is one row with its name, transport (and endpoint host for Streamable HTTP), tool count, and a state badge: connecting, connected, error, or disabled. A failing server shows its last error, the reconnect attempt counter, or why it stopped retrying. With no server configured, the tab says so and shows a minimal `cordis.patch.yml` entry. The Host never sends `env`, headers, arguments, or URL details, so the tab cannot show them.

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

Open the Plugins section in Settings and select the **MCP servers** tab. The tab reads no Remote during plugin activation: selecting it for the first time mounts the component and calls `ctx.remote.mcpStatus.list()` through `api-remotes`.

### Reading a row

The state badge reads `Connecting` while an attempt runs, `Connected` once the tools are synchronized, `Error` after a failure, and `Disabled` for an entry switched off in the configuration. An `Error` row shows the last failure message, `Reconnecting, attempt N of M` while a retry is scheduled, and the reason when no retry will follow: automatic reconnect is off, the attempt budget is spent, the old connection never confirmed it closed, or the plugin failed to start. A server that lost its connection keeps its last known tool count.

### Refreshing

The tab refreshes on demand with the **Refresh** button. While any server is connecting or has a retry pending, it also re-reads every three seconds without blanking the list, and stops once every server settles. A failed read shows the shared error marker with a retry button.

### Configuring a server

The empty state points to the profile's `cordis.patch.yml` and shows one `dsh-mcp-client` entry per server. [mcp-client](../../mcp/mcp-client/README.md) documents every field. To try the panel without a real service, point a stdio entry at `@modelcontextprotocol/server-everything`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tab is a read-only projection of a Host-owned snapshot. The browser plugin registers one localized `settings.plugins.tab` contribution with id `mcp`, ordered after the plugin list; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

Rows are keyed by the Host's `key`, so two servers that share a name stay distinct. The background refresh is a timer re-armed after each completed read, and only while the snapshot has a connecting server or a pending retry.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings section, the remote call, and the Host-side projection.

- [ui-settings-plugins](../ui-settings-plugins/README.md) — the Plugins section this tab registers into.
- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.tab`.
- [api-remotes](../../api/remotes/README.md) — the Remote BFF surface behind `mcpStatus.list()`.
- [api-mcp-status](../../api/mcp-status/README.md) — the Host-side status projection this tab renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side status projection that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the status view; they are current package constraints.

- **Polling, not push** — the Host exposes no change event, so the view re-reads while something is unsettled and otherwise on demand.
- **Read-only** — the tab has no reconnect, enable, or disable action; `dsh-mcp-client` offers no on-demand reconnect to call.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a read-only Settings contribution.
