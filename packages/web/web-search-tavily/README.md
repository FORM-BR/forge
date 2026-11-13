---
description: "The Tavily-backed search provider for ctx.web: how deployments mount vendor-native web search with extracted snippets and a generated answer."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-tavily

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-tavily`, the harness searches the web through Tavily and gets vendor-native results with extracted page snippets, publication dates, and an optional generated answer. Choose it when a deployment has a Tavily API key and wants Tavily's `basic` or `advanced` search. A result without a URL is dropped, so a call can return fewer sources than requested. The model-facing `web_search` tool lives in `dsh-tool-web`.

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

Mount the provider in a composition that already loads the web service; it registers as the `tavily` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: tavily`.

### When to choose it

Choose this backend when a deployment holds a Tavily API key and wants Tavily's content-extraction search with per-result snippets, publication dates, and a generated answer summary. The provider is unavailable — and every search call fails with a structured error — when the key is empty and no credential resolver is wired, or the endpoint base does not parse.

### Minimal configuration

Load the web service and the provider; the API key falls back to `$TAVILY_API_KEY` from the launch environment, and all other settings have safe defaults. When the credentials service is mounted, the key is resolved per search — store it with the web Models page and no restart is needed.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-tavily'
```

| Field | Default | Meaning |
|---|---|---|
| `apiKey` | `$TAVILY_API_KEY` | Tavily API key; empty or absent makes the provider unavailable unless a credentials service supplies one |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference resolved for each search and named by missing-credential diagnostics |
| `baseURL` | `https://api.tavily.com` | Endpoint base; `/search` is appended. `$TAVILY_BASE_URL` overrides it. An unparseable value makes the provider unavailable |
| `searchDepth` | `basic` | Retrieval depth sent as Tavily's `search_depth`: `basic` costs one credit per search, `advanced` two |
| `maxResults` | (unset) | Default result cap when a request carries no `maxResults`; must be a positive integer |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-tavily) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each Tavily result maps to a `WebSearchSource`: `url`, `title`, extracted page `content` as `snippet`, and `published_date` as `publishedAt`; a result with no URL is dropped. The optional generated `answer` becomes the result-level `content`. A request's `maxResults` wins over the configured `maxResults` default and is sent to Tavily as a cost and latency optimization — the final bound is enforced by the service, which truncates and flags.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`; a search whose key resolves empty surfaces as `WEB_PROVIDER_CREDENTIAL_MISSING`, naming the credential reference. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over Tavily's API with two deliberate rules:

- **The key is per-operation state, not provider state.** The plugin wires a credential resolver when the credentials service is mounted, so a key stored at runtime (the web Models page writes it) reaches the next search without re-registering the provider; without the service, the launch environment is resolved eagerly and an absent key is conclusive — the seam reports the provider unavailable instead of failing every search at dispatch.
- **Extracted content is the snippet.** Tavily extracts page content in the same call, so `content` maps to `snippet` directly; the generated `answer` is the only result-level `content`, never invented from other fields.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, credential-plane wiring, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `TavilySearchProvider`: key resolution, request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | Tavily wire types: `TavilySearchRequest`, `TavilySearchResponse`, `TavilyResult`, `TavilyError` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` posts the query, search depth, include flags, and optional result count to `{baseURL}/search` with `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `results[]` are mapped one by one, URL-less entries dropped, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the web-package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-tavily) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, extracted snippets, publication dates, generated answer, and its exact `Tavily search aborted`, `Tavily search request failed: <error>`, and `Tavily returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **A result with no URL is dropped entirely** — the URL is the seam source's only mandatory field, so fewer sources than requested can return.
- **Only `searchDepth`/`maxResults` are exposed** — Tavily's other controls (domain include/exclude, time range, topic, per-result raw content) wait on provider-neutral service fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: wider Tavily control surface

Tavily's domain include/exclude, time range, topic, and raw-content controls stay unexposed. Exposing them needs provider-neutral service fields first, so the family adds one coordinated control rather than a vendor-specific argument.

</details>
