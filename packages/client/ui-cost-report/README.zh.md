---
description: "浏览器端全局成本报告：在侧边栏面板列表中注册 Costs 面板，通过 ctx.remote.costReport 读取按天/按会话的账本聚合，按时间段、工作区根目录与模型过滤，并暴露 chat 成本 pill 用来打开面板的 costReportNavigation 快捷方式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cost-report

[English](README.md) | 中文

该面板是只读的浏览器界面；它从不写入账本，也不改变模型上下文。

## 概述

ui-cost-report 插件在侧边栏面板列表中注册全局 Costs 面板。面板通过注入的 `ctx.remote.costReport` 命名空间读取按天与按会话的聚合，支持用户按时间段、工作区根目录与模型过滤，并展示总费用、调用次数与 token 数、每日费用趋势以及会话明细。它还暴露一个 `costReportNavigation` 快捷方式，chat 成本 pill 用它直接打开面板。金额来自成本计量器的本地价格目录，仅供参考，不构成账单。

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

该插件向两个 slot 贡献：一个 `sidebar.panellist` 图标行，以及它选择显示的 root 作用域 `main` Costs 面板。把它与 cost-report Remote BFF、成本计量器一起挂载到 web 配置中，即可得到有数据的报告。

### 面板入口

侧边栏显示一个 Costs 图标，标签来自已注册的 locale。选择该行会打开 `main` 面板，面板在首次打开时加载数据。若未挂载成本计量器，面板会显示带类型的 `costReport/unavailable` 诊断与重试操作，而不是空表格。

### 过滤器与明细

头部过滤器按时间段（`fromDay`/`toDay`）、工作区根目录（`cwd`）与提供方/模型路由限定报告范围。工作区与模型下拉项来自命名空间自身的目录，因此每个选项都会过滤出非空结果。面板渲染每日费用趋势与每日的会话列表；打开新的一天分桶的会话行即为明细，过长的会话 id 会被截断以便阅读。

### 从 chat 成本 pill 打开

插件提供 `costReportNavigation` —— 一个 chat 客户端读取的可选导航服务。chat 成本 pill 的「Costs report」操作调用其 `open()` 关闭对话框并选择 Costs 面板。该服务的生命周期与面板注册完全一致，因此面板未挂载时快捷方式也随之卸载。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`apply` 注册面板的 `main` slot 与一个 `sidebar.panellist` 行，绑定 `costReport` locale 命名空间，并通过 bridge 生成的客户端注入 `costReport` Remote 服务。注入的 face 包装每个 `ctx.remote.costReport` 方法，把不成功的结果转成描述性的本地错误。store 是在生成器中创建、通过注册的 store 句柄共享的每实例快照 store，因此重新挂载时当前选择与过滤器得以保留。`costReportNavigation` 通过可选服务模式提供：provider 闭包解析面板 id，并在注册让位时释放快捷方式。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面涵盖本面板读取的 Host 服务与它所接入的导航面。

- [cost-report](../../api/cost-report/README.zh.md)——提供 `ctx.remote.costReport` 命名空间的 Remote BFF。
- [cost-meter](../../llm/cost-meter/README.zh.md)——维护这些读取背后的 SQLite 账本的会看重放计量器。
- [ui-sidebar](../ui-sidebar/README.zh.md)——承载面板列表行的侧边栏外壳。
- [可选服务标准](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)——导航快捷方式所遵循的 seam 模式。

-----

<a id="model-experience"></a>
## 模型体验

无。本包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；面板不组装任何提供方请求，也不改变模型上下文。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


以下限制是当前包约束；它们界定了 v1 面板做什么、延期什么。

- **仅面板消费**：v1 只提供可视化报告；没有 CLI 或导出命令。
- **估测而非账单**：金额来自成本计量器的本地价格目录，仅供参考。
- **结算在下次加载时落地**：账本异步镜像，因此刚结算的事件会在面板下次读取后出现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。被拥有的关系——面板注册、其 store、导航快捷方式的生命周期——由挂载并释放插件 fiber 的装配测试所断言。