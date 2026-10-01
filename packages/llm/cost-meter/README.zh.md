---
description: "会看重放的 API 成本计量服务（ctx.costMeter）：按 pi-ai 目录外加缓存的 OpenRouter 费率给持久化的助手结算定价，将当前会话的成本暴露为 costUsage 会话投影，并把每笔定价结算镜像到用户主目录下的 SQLite 账本。"
kind: "package-reference"
---

# @deepseek-ai/dsh-cost-meter

[English](README.md) | 中文

该计量器观察持久化会话日志；它在 Host 启动期间运行，从不改写任何提供方请求。

## 概述

成本计量器为上报了提供方用量的持久化助手结算定价，价格来自已安装的 pi-ai 目录费率（USD / 1M tokens）与缓存的 OpenRouter 费率的组合，并把当前会话的成本暴露为 `costUsage` 会话投影。每笔定价结算都会被镜像到用户主目录下的 SQLite 账本（`~/.dsh/statistics/costs.sqlite`），因此按天、按提供方/模型路由、按会话根目录、按会话聚合的历史在重启后依然存在。计量通过重放持久化会话日志完成，是确定性的，且不发起任何模型调用。启动时的一次 warm-sync 会用实时查找对账已存储的会话，且具备幂等性。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在配置文件组合中挂载该服务，即可跨会话计量 API 用量。它注册 `costMeter` 服务、一个会话投影以及 warm-sync 扫描；消费方通过 `ctx.costMeter` 读取。

### 会话成本投影

定价以会话流的观察者的身份进行：每个会话在首次被读取时获得一个惰性单元格，折叠会把该会话的持久化日志按实时查找重放一遍。`costUsage` 报告总成本、调用次数、未定价调用次数，以及按成本从高到低排序的逐路由成本。由于投影注册表对每个会话只具体化一次，计量器会在任何折叠运行之前从磁盘预热价格缓存，避免历史结算被冻结为未定价。

### 持久化账本

每笔定价结算都会被 upsert 到 `~/.dsh/statistics/costs.sqlite`（可配置）的 SQLite 账本中，键为（会话 id，事件 seq）。聚合按天、按提供方/模型路由、按会话根目录、按会话对该历史分组，通过 `costMeter` 读取面（`byDay()`、`byModel()`、`report()`）提供，供 cost-report Remote BFF 与浏览器成本面板消费。

### Warm-sync 对账

启动时，计量器会按实时价格查找把 `~/.dsh/sessions`（可配置）下存储的会话重放一遍，并为每个定价事件 upsert 一笔结算。upsert 键使重跑具备幂等性——重新处理某个事件会覆盖其行而绝不重复计数——同时离线、缺少会话根目录等失败会被吸收。只在测试中使用 `:memory:` 作为账本路径。

### 配置

`ledgerPath`（默认 `~/.dsh/statistics/costs.sqlite`，测试可用 `:memory:`）、`priceCachePath`（默认 `~/.dsh/statistics/openrouter-prices.json`）、`priceCacheTtlMs`（默认 24 小时）、`warmSync`（默认 `true`）以及 `sessionsRoot`（默认 `~/.dsh/sessions`）。未知键会被响亮地拒绝，拼写错误的选项无法藏身于默认值之后。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该服务把磁盘上的 OpenRouter 价格表与已安装的 pi-ai 目录组合成一个价格查找，注册 `costUsageProjectionDefinition`，并通过 `node:sqlite` 上的 `CostLedger` 镜像结算——`node:sqlite` 是本仓库唯一提供的驱动，因此每行即一个事件。同步驱动的每次单语句调用都会阻塞事件循环，符合仓库已接受的 storage-sqlite 模式。重放状态按会话存放在 `WeakMap` 中，未被读取的会话不承载任何状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面涵盖账本的消费方以及计量器所注册的投影注册表。

- [cost-report](../../api/cost-report/README.zh.md)——把账本聚合提供给浏览器成本面板的 Remote BFF。
- [ui-cost-report](../../client/ui-cost-report/README.zh.md)——渲染该报告的浏览器 Costs 面板。
- [session-projection](../../session/session-projection/README.zh.md)——`costUsage` 单元格所注册的投影注册表。

-----

<a id="model-experience"></a>
## 模型体验

无。该计量器只按本地价格目录给已记录的结算定价，不发起任何模型调用。

#### KV Cache 影响

无；计量器折叠提供方上报的用量，从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


以下限制是当前包约束；它们界定了计量器拥有什么、其消费方拥有什么。

- **估算而非账单**：金额来自本地价格目录与缓存的 OpenRouter 费率，仅供参考，不构成账单。
- **未定价路由折叠为零成本行**：提供方路由没有目录或表格价格的结算仍会计入账本，并带未定价标记，以便报告指出。
- **账本镜像持久化日志**：重放按（会话 id，seq）覆盖行；会话日志始终是事实来源，账本是派生的投影。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。每一行账本记录都由本包的测试所断言的同一套重放折叠从持久化会话日志派生而来，因此不变式检查只会重新描述被测代码路径。