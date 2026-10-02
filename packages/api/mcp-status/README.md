---
description: "Host Remote owner of MCP server connection status: serves a secret-free summary of every configured MCP server (state, transport, host, tool count, last error) over the generated mcpStatus namespace, and is the registry the dsh-mcp-client plugins report into."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-status

English | [中文](README.zh.md)

The Remote BFF runs in the Host process and serves read-only projections of live state; it never starts, stops, or reconfigures a server.

## Summary

The MCP status Remote BFF lets the browser show what is plugged in. It exposes one Typert namespace, `mcpStatus`, whose `list` method returns one summary per configured MCP server: name, transport, endpoint host, one of four states (`connecting`, `connected`, `error`, `disabled`), the number of synchronized tools, and the most recent failure message. The same service is the `mcpServerStatus` registry that every [`dsh-mcp-client`](../../mcp/mcp-client/README.md) plugin reports into. A summary never carries `env`, `headers`, arguments, a command line, or a URL beyond its host.

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

Mount the service in the profile composition next to the `dsh-mcp-client` entries. Consumers call the generated `ctx.remote.mcpStatus` namespace; the Web Settings [MCP servers tab](../../client/ui-settings-mcp/README.md) renders it. The shipped Web bundle mounts the service already. Without it, MCP servers run unchanged and nothing reports their state.

### What a summary contains

`list()` returns `{ servers }`, ordered by `serverName`. Each server has a `key` that stays unique when two scopes reuse a name, its `serverName`, its `transport` (`stdio`, `streamable-http`, or null when a disabled entry's config does not state it literally), `host` for Streamable HTTP only, its `state`, and its `toolCount`.

`connected` means the initial tool synchronization finished. `connecting` means an attempt is running, or the entry still waits for a service it needs. `error` carries a bounded `error` message once a failure is known. While a reconnect is scheduled or running, `retry` reports the consecutive failed attempts against the budget. When no further attempt will run, `halted` says why: `reconnect-disabled`, `attempts-exhausted`, `transport-unconfirmed`, or `load-failed`. During an outage `toolCount` keeps the last known tools, which matches how the model sees them.

### Disabled and failed entries

A disabled `dsh-mcp-client` entry never starts, so it cannot report. The service reads the Loader's entries for the module and lists each disabled entry as `disabled`, an enabled entry whose root Fiber failed or never existed as `error` with `halted: 'load-failed'`, and an entry still waiting for a service as `connecting`. For these rows only a literal `serverName`, a literal `transport`, and the host of a literal `url` are read; the entry id stands in for a missing name, and no expression is evaluated.

### Secrets

Failure messages are redacted where they are produced, inside `dsh-mcp-client`: configured env, header, and URL-query values, URL credentials, paths and queries, and `Bearer` or `Basic` credentials are replaced, and the text is cut at 240 characters.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`McpStatusService` extends `TypertRemoteService` under the service key `mcpServerStatus` and the wire namespace `mcpStatus`. `register(source)` adds one `McpServerStatusSource` through an effect owned by the calling plugin, so a reload or disposal of the MCP plugin removes its row. `list()` calls each source's `status()` and reads the Loader on every call; nothing is cached, so a response always reflects current state.

The `mcpServerStatus` Context key and the source and registry types are declared by `dsh-mcp-client`, which keeps that package free of any dependency on this one. `src/types.ts` holds only the browser-safe wire declarations.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpStatusService`: the registry, the `list` Remote, and the Loader join |
| [`src/types.ts`](src/types.ts) | Wire types: `McpServerSummary`, `McpStatusSnapshot`, `McpServerState`, `McpServerHalt` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the connection supervisor that produces the status and the panel that consumes this namespace.

- [mcp-client](../../mcp/mcp-client/README.md) — the plugin whose connection state and reconnect policy this service projects.
- [ui-settings-mcp](../../client/ui-settings-mcp/README.md) — the browser tab that renders the summaries.
- [Remote assembly](../remotes/README.md) — how clients consume `mcpStatus/list` without importing the Host implementation.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only serves read-only connection state to the browser and registers no prompt, tool, or session event.

#### KV Cache effect

None; the service never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints; they define what the status service owns versus what its neighbors own.

- **Point-in-time reads** — the Remote has no change subscription; a client re-reads to see transitions.
- **No control actions** — the service cannot reconnect, enable, or disable a server. The supervisor in `dsh-mcp-client` exposes no on-demand reconnect.
- **Failure reasons for failed entries are in the Host log** — a Loader entry that failed to load reports `load-failed` without a message, because the Loader keeps no error text on the Fiber.
- **Agent-scoped servers have no config-only rows** — a server declared inside an agent preset reports once it connects; while disabled or failed it has no Loader entry to list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The only owned relationship — a registration lives exactly as long as the plugin that made it — is the effect lifetime that this package's tests exercise, so an independent check would re-describe the same code path.
