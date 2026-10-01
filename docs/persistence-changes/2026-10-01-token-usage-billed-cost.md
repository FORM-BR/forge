---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-01-token-usage-billed-cost

English | [中文](2026-10-01-token-usage-billed-cost.zh.md)

## Summary

Adds an optional provider-billed USD amount (`costUsd`) to persisted token usage samples.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-token-usage-billed-cost
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "39aea4918333186466d0ef13e5e330d432c2e5f679709684037119207b9ec39a"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "b33384cad1bb37fde7462b897a6147555998e990aeff8240758b606bee2ba568"
    decision: same-version
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "b2200ff436821da1fac464f76fa7e4b90dd3b4def5a5aa906562850dde0b1314"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: the field is optional and absent from every log written before this change. Writers set it only when the provider reports the charged amount in its usage payload (OpenRouter `usage.cost`). Readers that predate the field ignore it; the cost meter uses it when present and falls back to its price catalog otherwise.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/llm/llm-pi-ai packages/llm/cost-meter packages/client/ui-cost-report: 430 tests passed, including an adapter test that streams `usage.cost` through a mock OpenAI-compatible server.

<a id="dev-note"></a>
## Dev Note

None.
