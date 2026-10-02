---
description: "Subagent conversation catalog, continuation routing UI, and '@' reference source for the dsh web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-subagent

English | [中文](README.zh.md)

## Summary

Use this package to browse every subagent conversation beneath a parent session, open any descendant, and see whether it is running together with its token usage and active-turn duration. Completed one-shot conversations open as read-only records. Continuable conversations accept follow-up prompts in submission order and provide Stop independently. The session sidebar omits subagent conversations, so the parent header catalog is their navigation entry point. The Agent Map Sidebar tab shows the delegation tree with live state and cost. The separate `@` source inserts a running child's label into a user message without resolving it into a continuation address.

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

The session header keeps the current session title as the lineage breadcrumb; when the session's direct catalog has entries or a read has failed, the descendant-count trigger renders at the start of the header actions band, with no breadcrumb separator. An absent catalog, an empty loading catalog, or a successfully loaded empty catalog hides the count trigger. The trigger opens that direct catalog, reports its total and running counts, and loads nested catalogs only when their rows expand. Select any depth to open that child's conversation with its exact `{parentSessionId, childSessionId, mode}` address, or use the row's trailing arrow to open the same address in the right Sidebar, preferring a separate pane when room permits.

This package registers the `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` resource and builtin Sidebar tab type. The resource retains the child `SessionReference` directly from its address without refreshing the parent catalog, and releases the reference when the tab record closes. The tab renders the shared `conversation.content` Factory through `sidebar.chat.conversation`, fixes the local View to Chat, and omits the main Conversation header and width controls.

### Browsing the tree

Hovering a trigger opens its catalog after 150ms; leaving both trigger and catalog closes it after 120ms. Clicking the descendant-count trigger pins its catalog until outside click or Escape from the trigger or tree. Breadcrumb-title clicks navigate to the corresponding conversation.

Rows display mode plus activity and an optional log-backed title; running uses the shared ongoing loader, an inactive child whose latest closed turn completed normally uses the shared success dot, and other inactive children use the shared idle dot. Every row reserves the same 14px status column, centering smaller dots so titles align with the loader state. The compact header trigger vertically centers its activity glyph and count with a 4px gap. The trailing column stacks total durable provider usage above active-turn duration. Keyboard navigation works with ArrowRight/ArrowLeft to expand and collapse branches and ArrowUp/ArrowDown, Home, End, and Escape to navigate or close the tree. An unlabeled one-shot row falls back to its session id. A row is a known leaf only after its own catalog loads empty.

### Continuing a conversation

A continuable child with a live parent keeps the ordinary input chrome: typing and Send stay available while the child runs because every follow-up joins the child's FIFO inbox, and an independent Stop routes through `subagents/interruptByParent`. A continuable child whose exact parent is unavailable and which is not running elects a read-only composer explaining the recovery path; while such a child still runs, the selector yields to the ordinary composer with input and Send disabled but its independent Stop usable.

### The `@` reference source

The `@` source remains deliberately separate and inert: candidates are zero-RPC running children from `ctx.sessions.list`, picking one inserts literal `@label ` text, and the codec projects `@label`. It has no command-adjudication hooks and does not resolve labels into continuation addresses.

### Agent Map

The right Sidebar registers an Agent Map page, opened from its guide or from the "Open Agent Map" link at the foot of the descendant-count catalog. The tree is rooted at the highest ancestor the client knows for the conversation that owns the Sidebar and lists every descendant with its label, mode, state, latest prompt, and metrics. State is waiting for you (a pending interaction), running, stopped early (the latest closed turn did not complete normally), completed, or not running. A running agent shows its in-progress todo; an idle agent shows a preview of its final response.

The header sums estimated cost, tokens, and agent count over the tree, and a row with children also shows its own subtree total. Cost comes from each Session's `costUsage` projection, so an agent without cost tracking shows a dash and adds nothing. Selecting a row opens that conversation by its exact address, the root row opens the root Session, and the trailing arrow opens the child in the Sidebar. Branches collapse and expand. When the lead Session publishes an `agentTeam` roster, its Lead and teammates carry a Team tag; teammates are ordinary continuable children and appear under the Lead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog and composer behavior are specified by the [Web subagent conversations note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) and the [current-turn interrupt note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md).

### Catalog derivation

The header lineage renderer reads `projectionsBySession` through the standard `useSessions` hook. The renderer selects `subagentCatalog` from each Session’s shared values for membership, disclosure, and counts; Activity prefers the unified UI status and falls back to Session summaries; summaries supply titles and usage. Expanding a row loads its initial catalog when needed. Live projection frames update every loaded level without menu subscriptions or repeated membership queries. A row remains expandable while its catalog is absent, loading, or failed, and becomes a known leaf after a ready empty catalog.

Opening a catalog dropdown does not request its root catalog. Child-catalog expansion and failed-read retries call `refreshProjection`; shared projection-value changes update the display automatically.

Breadcrumb addresses derive from the Provider-bound Session address and loaded parent catalogs, including never-selected ancestors.

### Duration, completion, and tokens

Each visible catalog level advances its own clock while it contains a running child; collapsing the level or closing the menu releases that clock. Token totals sum the four disjoint `tokenUsage` buckets. The `subagentTiming` projection sums completed-turn duration and records whether the latest closed turn ended with `completed`; opening another turn clears that completion until its own `turn/end`. Duration advances once per second only for an open turn on a running child and freezes after the child becomes inactive; an interrupted open turn is bounded by its same-cut `active.through`, never by newer session metadata.

### Agent Map derivation

`agent-map/model.ts` folds `projectionsBySession`, the Session list rows, and live Session status into one tree: membership comes from each agent's `subagentCatalog`, state from pending interaction, running status, and `subagentTiming`, activity from the `todos` and `turnOutline` projections, and cost from `costUsage`. The tab asks `refreshProjection` once for every agent whose catalog was never read, so the tree grows to full depth without expanding rows. Token and duration formatting is shared with the catalog dropdown through `metrics.ts`. The `agentTeam` roster is read structurally and validated per row, because this stable package must not depend on the experimental Team package. Cycles in malformed catalogs are cut at the repeated id.

### Composer election

One-shot children always elect a read-only composer. A continuable child elects one only when its exact parent is unavailable and the child is not running; otherwise the ordinary composer's Session routes prompts through `subagents/prompt`. This package never receives host context or calls a model-facing tool.

Unknown-mode catalog rows remain visible and clickable, using the child id when no label is available. Their composer is read-only until child history establishes a supported mode; a read failure is reported in the child conversation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the conversation surface, the host seam, and the design notes.

- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the header action and composer chain.
- [ui-input-trigger](../ui-input-trigger/README.md) — the suggestion machinery hosting the `@` source.
- [subagent](../../subagent/subagent/README.md) — the host-side capability seam behind continuable children.
- [cost-meter](../../llm/cost-meter/README.md) — the `costUsage` projection the Agent Map prices agents from.
- [Web subagent conversations](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) — the catalog and composer specification.
- [Current-turn interrupt](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md) — the independent Stop semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Subagent label text in the user prompt

#### What the model sees

Only the `@` reference source affects model input: a picked candidate reaches the ordinary user message as literal `@label`, without a dedicated block or host-side resolution. Catalog browsing, child navigation, and persisted transcript viewing add no prompt section; accepted continuation content becomes a normal FIFO user message through the host subagent adapter.

#### Token effect

Conditional and append-only: the literal `@label` or a human follow-up adds tokens only to its new user message. Catalog and transcript operations add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the catalog can show and what `@` references mean; they are current package constraints.

- **Non-completed inactive outcomes remain grouped** — the catalog distinguishes a latest normal completion from other inactive states, but does not distinguish failure, cancellation, refusal, token exhaustion, or a child with no closed turn; the UI exposes no Activation identity, and stopping is limited to the composer's current-turn Stop for a running continuable child.
- **The map shows the in-progress todo, not the running tool call** — no projection carries the active tool, so an agent without a todo list shows only its state and latest prompt.
- **Cost needs the cost meter** — amounts are catalog estimates from the `costUsage` projection; without the plugin every cost reads as a dash.
- **`@` references remain display-title text** — duplicate or renamed labels are ambiguous, so they intentionally do not acquire continuation semantics.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers a single slash source whose disposal is proven by the HMR-safety spec; it emits no Cordis events and owns no cross-plugin mutable state.
