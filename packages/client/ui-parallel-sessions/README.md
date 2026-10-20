# @deepseek-ai/dsh-client-ui-parallel-sessions

English | [中文](README.zh.md)

## Summary

The offered-sessions card: it renders a `suggest_parallel_sessions` call as the list the model proposed, and starts the chosen task as its own session. The card reads only the logged call, so replay rebuilds the same offer; the gesture, the session creation, the prompt, and the navigation happen in this plugin's apply closure.

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

The header counts the offered tasks and names the state of the call. Every task shows its title and its prompt, with one button that creates a session in the offering session's workspace, sends the offered prompt as the session's first turn, and opens the session in the main region. The button reports `Starting…`, then `Opened`, or `Could not start the session` for that task alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The card is a projection of the log plus one user gesture. It declares the keyed `tool.call.toolview` entry for `suggest_parallel_sessions`, so the generic Tool row is replaced without touching the Tool layer. Per-task outcomes are component-local: they describe what this visit did, not durable session state, and a remount legitimately forgets them.

Session creation is the client's job because the offer is a suggestion, never a side effect of the model's call: the tool only records what it proposed.

### Source map

| File | Role |
|---|---|
| `src/client/index.ts` | Registration, dictionaries, and the start action (create, prompt, open) |
| `src/client/ParallelSessionsRow.tsx` | Card component, task parsing, per-task outcome state |
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
- **No parallel start.** Each button starts one session; the card never opens several at once.
- **No placeholder for duplicated work.** Two users (or one user twice) can start the same task twice.
- **The prompt is sent as a plain first turn.** Slash commands in an offered prompt are not arbitration-checked by the composer.
