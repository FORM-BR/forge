---
description: "Host Remote owner of the configured MCP servers: serves a secret-free summary of each one (state, transport, host, tool count, last error, hidden-value definition) over the generated mcpStatus namespace, adds, edits, toggles, and removes dsh-mcp-client rows in the profile patch, and is the registry the dsh-mcp-client plugins report into."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-status

English | [中文](README.zh.md)

The Remote BFF runs in the Host process. Reads are projections of live state; writes only touch the `dsh-mcp-client` rows of the profile patch, through the config editor.

## Summary

The MCP status Remote BFF lets the browser show what is plugged in. It exposes one Typert namespace, `mcpStatus`, whose `list` method returns one summary per configured MCP server: name, transport, endpoint host, one of four states (`connecting`, `connected`, `error`, `disabled`), the number of synchronized tools, and the most recent failure message. The same service is the `mcpServerStatus` registry that every [`dsh-mcp-client`](../../mcp/mcp-client/README.md) plugin reports into. A summary never carries an `env` or header value, a secret-looking argument, or URL credentials and query values. The same namespace also adds, edits, switches, and removes servers in the profile patch (`save`, `setEnabled`, `removeServer`) and opens the patch files in a text editor (`openConfigFile`); secrets travel only toward the Host, and a saved value is never returned.

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

### Where a definition lives

`list()` also reads the patch files and joins each `dsh-mcp-client` row to its server by `serverName`. A summary then carries `source` (`profile` or `home`; absent for a bundle or command-line layer), `pendingRestart` for a saved row the Loader has not mounted, and `config`: the entry `id`, `disabled`, whether the form can edit it, the command, the arguments, the URL, and the **names** of the environment variables and headers. Arguments after a credential-named option, `NAME=value` assignments with a credential name, and credential-shaped tokens are replaced by bullets, as are URL userinfo, query values, and opaque path segments. `management` says whether the profile may be edited (`writable`, or `readOnlyReason` of `safe-mode` or `no-profile`) and shows both file paths with the home directory abbreviated.

### Edit from the panel

Only rows of the profile patch can be written; a server defined in the user-wide `~/.dsh/cordis.patch.yml`, a bundle, or a command-line overlay is read-only and answers `mcpStatus/read-only`.

- `save(draft, id)` adds a server (`id` absent) as its own `insert` item with the id `mcp-<name>`, or replaces the fields the form owns on an existing row. A `null` env or header value, a `null` URL, and an argument sent as `{ keep: index }` retain the stored node, so unchanged secrets are never retyped; keys omitted from the draft are removed. Names must match `[A-Za-z0-9_-]{1,32}` and be unused; a bad submission answers `mcpStatus/invalid` with the field.
- `setEnabled(id, enabled)` sets or clears `disabled` on the row; `removeServer(id)` deletes it and drops an `insert` item left empty. A vanished row answers `mcpStatus/not-found`.
- `openConfigFile('profile' | 'home')` opens the file in the native editor.

Each write goes through `ctx.configEditor.editDocument`, which holds the profile lock and the HMR exclusion, writes the file atomically, and reloads the profile in place. A reload that fails is rolled back and answers `mcpStatus/apply-failed` with the reason, scrubbed of the submitted secrets. The answer is `applied`, `pending` when the server was still starting after about eight seconds (the reload finishes in the background and still rolls back on failure), or `restart-required` when the host cannot reload in place. Edits keep comments and every field the form does not own, such as `cwd`, `reconnect`, and `!!js` expressions; a row with an expression in a form field can be toggled or removed but not edited.

### Agent tool

The `@deepseek-ai/dsh-api-mcp-status/tool` entry registers `mcp_servers`, a read-only tool that returns the same snapshot as `list()`. The shipped `mcp` agent preset mounts it so its assistant reads the state the panel shows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`McpStatusService` extends `TypertRemoteService` under the service key `mcpServerStatus` and the wire namespace `mcpStatus`. `register(source)` adds one `McpServerStatusSource` through an effect owned by the calling plugin, so a reload or disposal of the MCP plugin removes its row. `list()` calls each source's `status()` and reads the Loader on every call; nothing is cached, so a response always reflects current state.

The `mcpServerStatus` Context key and the source and registry types are declared by `dsh-mcp-client`, which keeps that package free of any dependency on this one. `src/types.ts` holds only the browser-safe wire declarations.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpStatusService`: the registry, the `list`, `save`, `setEnabled`, `removeServer`, and `openConfigFile` Remotes, and the Loader and patch-file join |
| [`src/patch-file.ts`](src/patch-file.ts) | Pure, comment-preserving edits of the `dsh-mcp-client` rows in a patch file's text |
| [`src/mask.ts`](src/mask.ts) | Display masking of arguments and URLs, and scrubbing of submitted secrets from messages |
| [`src/tool.ts`](src/tool.ts) | The `mcp_servers` agent tool |
| [`src/types.ts`](src/types.ts) | Wire types: summaries, definition views, drafts, management, and the error codes |

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

### MCP servers tool

#### What the model sees

The [`mcp_servers` tool](../../../docs/tool-catalog.md#deepseek-aidsh-api-mcp-status) returns the same secret-free snapshot as the Settings panel: each server's state, transport, tool count, last error, definition source, and a view of its configuration with every secret value hidden. It takes no arguments, changes nothing, and injects no message. Only a preset that mounts the `/tool` entry carries it; the shipped `mcp` preset does.

#### Token effect

The tool declaration is present when its consumer is mounted; each call adds one JSON snapshot that grows with the number of configured servers.

#### KV Cache effect

The declaration is constant, so mounting it does not move the cache prefix between turns. Results append to the transcript like any tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints; they define what the status service owns versus what its neighbors own.

- **Point-in-time reads** — the Remote has no change subscription; a client re-reads to see transitions.
- **No reconnect action** — the service can switch a profile server off and on but cannot reconnect one in place; the supervisor in `dsh-mcp-client` exposes no on-demand reconnect.
- **Profile rows only** — servers defined in the user-wide patch, a bundle, or a command-line overlay are listed read-only; editing them means editing their file.
- **Hot reload needs the root Include entry** — a Host started without it keeps the written file and answers `restart-required`.
- **Failure reasons for failed entries are in the Host log** — a Loader entry that failed to load reports `load-failed` without a message, because the Loader keeps no error text on the Fiber.
- **Agent-scoped servers have no config-only rows** — a server declared inside an agent preset reports once it connects; while disabled or failed it has no Loader entry to list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The only owned relationship — a registration lives exactly as long as the plugin that made it — is the effect lifetime that this package's tests exercise, so an independent check would re-describe the same code path.
