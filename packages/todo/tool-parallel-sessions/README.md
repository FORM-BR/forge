---
description: "Model-facing forked-session offer: the suggest_parallel_sessions tool, its task bounds, the result line, and the system-prompt guidance that makes the offer reachable from a user's own words; for users and maintainers of parallel-session offers."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-parallel-sessions

English | [中文](README.zh.md)

## Summary

The `suggest_parallel_sessions` tool lets the model offer part of a plan as separate sessions. It carries the offer only: two to four tasks, each with a title and a self-contained prompt. The call and its result are logged like any other tool pair, so a replayed session rebuilds the offer, and the Web client renders the card whose per-task action starts the session. Registering the tool also publishes a system-prompt section, so the model offers parallel work on its own instead of waiting for the user to name the tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### When to choose it

Load the tool when the deployment shows a Web client that can start sessions, and when the agent has independent work to split: migrations per package, one review per document, or one investigation per failing service. Without a client that renders `suggest_parallel_sessions`, the offer reaches the user as plain tool output and adds nothing to `todo_write`.

### Minimal configuration

The tool takes no configuration:

```yaml
- id: tool-parallel-sessions
  name: '@deepseek-ai/dsh-tool-parallel-sessions'
```

### What each call does

`execute` validates the bounds the parameter schema cannot express — two to four tasks, trimmed non-empty titles and prompts, distinct titles — and echoes the accepted list. Nothing is started: the user's click on the card creates each session and submits its prompt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The offer is data, not a side effect. The tool registers no session event and no projection because the tool-call pair already satisfies "model-visible ⟺ logged": the log holds exactly what the model proposed, and every client renders from it. Starting sessions stays a user gesture in the client, which already owns session creation and navigation.

The model-facing reach is split the way the registries are: the tool description says what a valid offer is, and a system-prompt section says when to make one. Users ask for this work in their own words — parallel sessions, new sessions, splitting the work — so the section names those requests; without it the model waits to be told the tool name.

### Source map

| File | Role |
|---|---|
| `src/index.ts` | Tool declaration, system-prompt guidance, bounds validation, result rendering, call presentation |

### Export shape

Named exports only: `name`, `inject`, `apply`, and the `ParallelTask` interface. No default export, which would make the Loader discard the injection metadata.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The description asks for two to four independent tasks, each with a short unique title and a prompt that stands on its own, and tells the model to treat a user request for new or parallel sessions as this tool. The `tasks` array is required; every item requires `title` and `prompt` and rejects unknown keys. A system-prompt section published by the same plugin states when to offer the split and which user phrasings mean it.

#### Token effect

The schema is fixed overhead on every request in a deployment that loads it: one object with two string fields, plus the description above. Calls return the tasks unchanged, so the result adds no tokens beyond what the model wrote.

#### KV Cache effect

The schema and description are stable for the life of the plugin, so they do not invalidate the cached prefix between turns.

### Tool-call history and result

#### What the model sees

The call keeps the proposed tasks as arguments. The result renders one line — `Offered 2 parallel sessions: Waitlist copy; Pricing table.` — and rejects invalid lists with a message naming the violated bound.

#### Token effect

One short line per call. The arguments are the bulk of the cost and are the model's own output.

#### KV Cache effect

Each call appends to the transcript, so earlier cached content stays valid; the line itself joins the cache prefix from the next request onward.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No start semantics in the tool.** The offer cannot begin work; a model that wants the tasks to run must propose them and wait for the user.
- **No coupling with `todo_write`.** The model decides when a list has splittable items; the client's hint reflects pending count, not the tasks the tool offers.
- **No locale of its own.** The card copy lives in the client package that renders it.

### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
