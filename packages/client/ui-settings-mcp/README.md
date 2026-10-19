---
description: "MCP servers tab in Web Plugins settings for the dsh web client: connection state, transport, endpoint host, tool count, and the last error of every configured MCP server, with a form to add, edit, switch, and remove profile servers, a way into the patch files, and a button that starts the MCP assistant."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

## Summary

The **MCP servers** tab lets Web users see which MCP servers are plugged in and whether they work. Each server is one row with its name, transport (and endpoint host for Streamable HTTP), tool count, and a state badge: connecting, connected, error, or disabled. A failing server shows its last error, the reconnect attempt counter, or why it stopped retrying. With no server configured, the tab says so and shows a minimal `cordis.patch.yml` entry. Profile servers can be added, edited, switched off and on, and removed from the tab itself, and a button starts a session with the MCP assistant. The Host never sends an `env` or header value, a secret-looking argument, or URL credentials, so the tab cannot show them.

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

### Adding and editing a server

**Add server** opens a form: a name (the prefix of the server's tools), a connection type, and the fields that type needs. A local program (stdio) takes a command, arguments, and environment variables; a remote server (HTTP) takes a URL and headers. The form checks the obvious mistakes before sending; the Host checks again and a refusal appears on the field it names. **Edit** on a row opens the same form. Values that are secrets are write-only: an environment variable or header shows only its name, a stored value is replaced by typing a new one and kept by leaving the field empty, a credential-looking argument starts empty the same way, and a URL with hidden parts is kept by leaving it untouched. A saved change reports whether it is live, still starting, or needs a restart; a change the Loader rejects is rolled back and its reason is shown.

Each profile row also has a switch to turn the server off and on, and **Remove**, which asks first. Comments and every field the form does not own stay in the file. A row with an expression the form cannot represent can be switched and removed, but its Edit stays disabled; change it in the file.

### Servers defined elsewhere

Only the profile's own `cordis.patch.yml` is edited from the tab. A server from the user-wide `~/.dsh/cordis.patch.yml` is shown read-only with the file's path and an **Open that file** button, and one from a bundle or a command-line option says so. **Open configuration file** in the toolbar opens the profile patch in a text editor, so the YAML route stays available. In safe mode, or without a profile, the tab hides every write control and says why. [mcp-client](../../mcp/mcp-client/README.md) documents every field. To try the panel without a real service, point a stdio entry at `@modelcontextprotocol/server-everything`.

### Asking the agent

**Ask the agent for help** starts a new session on the shipped `mcp` preset and closes Settings. The preset reads the same state as the tab, shows each change to the configuration before writing it, never repeats a secret, and recommends a dedicated session for work such as writing or debugging a server. The button is disabled while Developer tools are off and absent when no conversation flow exists.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tab is a projection of a Host-owned snapshot plus a thin write path to it. The form model in `src/client/draft.ts` turns a stored definition into rows and the rows into the write-only draft, sending an untouched hidden value back as "keep" instead of text. The browser plugin registers one localized `settings.plugins.tab` contribution with id `mcp`, ordered after the plugin list; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

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

None, as the package registers nothing model-facing; the assistant it launches is the `mcp` preset declared by the web bundle.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the freshness and reach of the status view; they are current package constraints.

- **Polling, not push** — the Host exposes no change event, so the view re-reads while something is unsettled and otherwise on demand.
- **No reconnect action** — the tab can switch a server off and on but not reconnect it in place; `dsh-mcp-client` offers no on-demand reconnect to call.
- **Profile rows only** — servers defined in the user-wide patch, a bundle, or a command-line option are not editable here.
- **No command-line paste** — the form takes one argument per field; it does not split a pasted command line.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns one Settings contribution and its form.
