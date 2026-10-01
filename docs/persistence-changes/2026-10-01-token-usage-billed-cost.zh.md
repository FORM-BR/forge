---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-01-token-usage-billed-cost

[English](2026-10-01-token-usage-billed-cost.md) | 中文

## 概述

为持久化的 token 用量样本新增可选的服务商计费金额（美元，`costUsd`）。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：该字段可选，本次变更之前写入的日志都不包含它。仅当服务商在用量数据中报告实际扣费金额（OpenRouter 的 `usage.cost`）时写入方才设置该字段。不认识该字段的旧读取方会忽略它；费用计量在字段存在时使用它，否则回退到价格目录估算。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/llm/llm-pi-ai packages/llm/cost-meter packages/client/ui-cost-report：430 个测试通过，其中包括一个通过模拟 OpenAI 兼容服务器流式返回 `usage.cost` 的适配器测试。

<a id="dev-note"></a>
## 开发备注

无。
