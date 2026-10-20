---
description: "Web card for a suggest_parallel_sessions call: the offered tasks pinned above the transcript as a popup, whose Open menu starts a session in this workspace or in a new git worktree beside the repository; for users and maintainers of parallel-session offers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-parallel-sessions

English | [中文](README.zh.md)

## Summary

The offered-sessions card: it renders a `suggest_parallel_sessions` call as the list the model proposed, and starts the chosen task as its own session. The card is pinned above the transcript, so an offer reaches the user wherever they are reading; the call leaves only a one-line trace in the transcript. Both surfaces read only the logged call, so replay rebuilds the same offer; the gesture, the session creation, the prompt, and the navigation happen in this plugin's apply closure.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Load it beside `@deepseek-ai/dsh-tool-parallel-sessions` in any Web deployment that lets the model propose parallel work. Without this card the offer arrives as generic tool output: readable, but with nothing to click.

### Minimal configuration

The plugin takes no configuration:

```yaml
- id: ui-parallel-sessions
  name: '@deepseek-ai/dsh-client-ui-parallel-sessions'
```

### What the card does

The transcript keeps a one-line trace: the count of offered tasks and the note that the card is pinned above. The card itself floats over the top of the column — the `conversation.notice` seat — and carries the whole offer: a header with the count and a close button, and one row per task with its title, a `?` control whose tooltip reveals the prompt, and an `Open` button that opens a menu of `Local` and `Worktree`. `Local` creates the session in the offering session's workspace, and `Worktree` first creates a worktree beside the repository and adopts it as its own Workspace, so the parallel session writes in a checkout of its own. Either choice sends the offered prompt as the session's first turn and opens the session in the main region. The button reports `Starting…`, then `Opened`, or `Could not start the session` for that task alone; a started task leaves the card, and closing the card withdraws what is left. The menu is portaled, because the card clips its own overflow and the list would otherwise be cropped.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The offer is a projection of the log plus one user gesture. The plugin declares the keyed `tool.call.toolview` entry for `suggest_parallel_sessions`, so the generic Tool row is replaced without touching the Tool layer, and a `conversation.notice` entry whose card floats at the top of the column. The offer itself lives only in the logged call, and the notice chain's owner data does not carry it, so the transcript row publishes what it rendered into a plugin-owned store and the pinned card reads that store through the inject `hooks` compartment. A later call replaces the offer, and a settled or dismissed entry ignores further publication of the same call. Per-task outcomes are component-local: they describe what this visit did, not durable session state, and a remount legitimately forgets them.

The notice entry always takes its seat and decides visibility itself: it renders nothing while the Session holds no offer. A pending question keeps precedence over the offer, because the question entry selects first in the chain and an unanswered question is what stalls the turn.

Session creation is the client's job because the offer is a suggestion, never a side effect of the model's call: the tool only records what it proposed.

The worktree destination is `workspaces.createWorktree`, a Host command that runs `git worktree add` on a new `forge/<slug>` branch in a sibling `<repo>-worktrees/<slug>` directory. The card never invents a checkout in the browser: it asks the Host, then registers the resulting path as a Workspace so the new session has a row in the sidebar like any other.

### Source map

| File | Role |
|---|---|
| `src/client/index.ts` | Registration, dictionaries, and the start action (create, prompt, open) |
| `src/client/ParallelSessionsRow.tsx` | Transcript line, task parsing, and the publication of the offer |
| `src/client/ParallelSessionsNotice.tsx` | Card pinned above the transcript, per-task outcome state |
| `src/client/offer-store.ts` | Per-Session offer map shared by the row and the pinned card |
| `src/client/locales.ts` | `parallelSessions` namespace dictionaries |

### Export shape

The browser half exports `apply` and `inject` only. The component and its injected face stay internal; the card receives its action through the registration's inject face, not a public module.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

Nothing. This package adds no tool, prompt text, or schema; the model-facing surface belongs to `@deepseek-ai/dsh-tool-parallel-sessions`.

#### Token effect

None.

#### KV Cache effect

None.

### Tool-call history and result

#### What the model sees

The same call and result it already saw: the card is rendered from them and appends nothing.

#### Token effect

None.

#### KV Cache effect

None.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No durable record of which offers were started.** A replayed session shows every task as available again, even after the user started it.
- **The pinned card lives as long as its transcript row.** The offer reaches the card through the row that rendered the call, so a view that does not render the transcript (Trajectory, a takeover) leaves the card empty until the row mounts again.
- **A worktree starts from the current HEAD.** Uncommitted work in the offering checkout is not carried over, and the new branch stays local until the user pushes it.
- **No parallel start.** Each button starts one session; the card never opens several at once.
- **No placeholder for duplicated work.** Two users (or one user twice) can start the same task twice.
- **The prompt is sent as a plain first turn.** Slash commands in an offered prompt are not arbitration-checked by the composer.

### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
