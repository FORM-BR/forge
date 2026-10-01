---
description: "全局成本报告的 Host Remote 所有者：通过生成的 costReport 命名空间，提供成本计量器 SQLite 账本按天、按工作区（cwd）、按提供方/模型路由、按会话的聚合，以及工作区与路由目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-cost-report

[English](README.md) | 中文

该 Remote BFF 在 Host 进程中运行，只提供只读投影；它从不按需定价或计量。

## 概述

cost-report Remote BFF 以 Typert 命名空间（`costReport`）向全局成本面板呈现数据。它的方法把成本计量器维护的 SQLite 账本投影为按天、按工作区根目录、按提供方/模型路由、按会话的分桶（含闭区间可选过滤器），并列出面板过滤器所提供的工作区与路由。线的分桶形状有意与 Host 账本行保持一致，使账本的 `node:sqlite` 依赖永远不进入浏览器 bundle。当未挂载成本计量器时，命名空间保持注册，并返回可操作的 `costReport/unavailable` 诊断，而不是协议失败。

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

在配置文件组合中挂载该服务，即可把成本账本暴露给浏览器。消费方调用生成的 `ctx.remote.costReport` 命名空间；面板渲染报告，本包负责应答。

### 报告分桶

`report({ group, filter })` 把账本聚合为每个有结算分桶一行。分组为 `day`、`cwd`（会话根目录）、`model`（提供方/模型路由）与 `session`；闭区间的 `filter` 通过 `fromDay`/`toDay`、`cwd`、`provider`、`model` 与 `sessionId` 限定范围。按天分组时行升序排列，否则按成本最高的优先，使面板的默认视图先展示花费最大的部分。

### 工作区与路由目录

`workspaces()` 返回有结算事件的会话根目录（升序），`models()` 返回提供方/模型路由（先按提供方再按模型）。面板据此构建过滤器下拉项，因此每个可选项都会过滤出非空结果。

### 缺少计量器

读取要求 cost meter 服务存在。当 `ctx.costMeter` 未挂载时，每次读取都会抛出带类型的 `costReport/unavailable` RemoteError，其消息提示操作员在配置文件组合中挂载 `@deepseek-ai/dsh-cost-meter`——面板会展示该指引，而不是静默的空报告。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`CostReportService` 以 `costReport` 命名空间继承 `TypertRemoteService`，并把每个方法转发给解析出的成本计量器。`meter()` 读取 `ctx.get('costMeter')`，缺失时抛出带操作指引的 RemoteError；由于服务自身保持挂载，命名空间永远不会从生成的客户端中消失，因此浏览器总能得到带类型的、可呈现的失败。`src/types.ts` 只承载浏览器安全的线声明——不含运行时代码——并有意复制 Host 账本形状，使 `node:sqlite` 远离每个浏览器 bundle。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面涵盖账本的所有者与消费本命名空间的面板。

- [cost-meter](../../llm/cost-meter/README.zh.md)——维护这些读取背后的 SQLite 账本的会看重放计量器。
- [ui-cost-report](../../client/ui-cost-report/README.zh.md)——渲染报告与过滤器的浏览器 Costs 面板。

-----

<a id="model-experience"></a>
## 模型体验

无。本包只向浏览器成本面板提供只读账本投影，不注册任何 prompt、工具或会话事件。

#### KV Cache 影响

无；该服务解析无头的账本读取，从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


以下限制是当前包约束；它们界定了 BFF 拥有什么、相邻包拥有什么。

- **只读交付**：v1 只提供聚合读取；写入或回填账本属于成本计量器。
- **线形状按约定复制账本**：浏览器安全的桶类型镜像 Host 账本行；当模型的成本面变化时，两侧必须同步更新。
- **缺少计量器时响亮失败**：未挂载的成本计量器表现为 `costReport/unavailable` 而非空报告，这正是预期的诊断。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。唯一被拥有的关系——命名空间所有者映射——已由服务注解声明，并由本包的 Remote 测试执行；独立的检查只会重新描述同一代码路径。