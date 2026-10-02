---
description: "MCP 服务器连接状态的 Host Remote 负责方：通过生成的 mcpStatus 命名空间提供每个已配置 MCP 服务器的无密钥摘要（状态、传输方式、主机、工具数量、最近一次错误），并作为 dsh-mcp-client 插件上报状态的注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-status

[English](README.md) | 中文

该 Remote BFF 运行在 Host 进程中，只提供实时状态的只读投影；它不会启动、停止或重新配置任何服务器。

## 概述

MCP 状态 Remote BFF 让浏览器能够看到当前接入了什么。它暴露一个 Typert 命名空间 `mcpStatus`，其 `list` 方法为每个已配置的 MCP 服务器返回一条摘要：名称、传输方式、端点主机、四种状态之一（`connecting`、`connected`、`error`、`disabled`）、已同步的工具数量，以及最近一次失败信息。同一个服务也是 `mcpServerStatus` 注册表，每个 [`dsh-mcp-client`](../../mcp/mcp-client/README.zh.md) 插件都向它上报状态。摘要中从不包含 `env`、`headers`、参数、命令行，也不包含主机之外的任何 URL 部分。

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

在配置档组合中，把该服务挂在 `dsh-mcp-client` 条目旁边。使用方调用生成的 `ctx.remote.mcpStatus` 命名空间；Web 设置里的 [MCP 服务器标签页](../../client/ui-settings-mcp/README.zh.md)负责渲染。随附的 Web 捆绑包已经挂载了该服务。没有它时，MCP 服务器照常运行，只是没有任何地方上报它们的状态。

### 摘要包含什么

`list()` 返回 `{ servers }`，按 `serverName` 排序。每个服务器带有：在两个作用域复用同名时仍保持唯一的 `key`、`serverName`、`transport`（`stdio`、`streamable-http`，或在已停用条目的配置没有字面写明时为 null）、仅 Streamable HTTP 才有的 `host`、`state` 与 `toolCount`。

`connected` 表示首次工具同步已完成。`connecting` 表示有一次尝试正在进行，或条目仍在等待它需要的服务。已知失败后，`error` 状态带有一条有长度上限的 `error` 信息。重连已排期或正在进行时，`retry` 给出本轮连续失败次数与预算。不会再有后续尝试时，`halted` 说明原因：`reconnect-disabled`、`attempts-exhausted`、`transport-unconfirmed` 或 `load-failed`。故障期间 `toolCount` 保留最后已知的工具，与模型看到的一致。

### 已停用与失败的条目

已停用的 `dsh-mcp-client` 条目不会启动，所以无法上报。该服务读取 Loader 中此模块的条目：已停用的条目列为 `disabled`；已启用但根 Fiber 失败或从未创建的条目列为 `error` 且 `halted: 'load-failed'`；仍在等待服务的条目列为 `connecting`。对这些行只读取字面的 `serverName`、字面的 `transport` 以及字面 `url` 的主机；缺少名称时用条目 id 代替，也不会求值任何表达式。

### 密钥

失败信息在产生它的 `dsh-mcp-client` 内部就已脱敏：配置中的 env、header 与 URL 查询值、URL 凭据、路径与查询，以及 `Bearer`、`Basic` 凭据都会被替换，文本截断为 240 个字符。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`McpStatusService` 继承 `TypertRemoteService`，服务键为 `mcpServerStatus`，线路命名空间为 `mcpStatus`。`register(source)` 通过调用方插件拥有的 effect 添加一个 `McpServerStatusSource`，因此 MCP 插件重载或销毁时，它的行会随之移除。`list()` 调用每个来源的 `status()`，并在每次调用时读取 Loader；没有任何缓存，响应始终反映当前状态。

`mcpServerStatus` 这个 Context 键以及来源和注册表类型由 `dsh-mcp-client` 声明，使该包无需依赖本包。`src/types.ts` 只包含可用于浏览器的线路类型声明。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpStatusService`：注册表、`list` Remote 以及与 Loader 的合并 |
| [`src/types.ts`](src/types.ts) | 线路类型：`McpServerSummary`、`McpStatusSnapshot`、`McpServerState`、`McpServerHalt` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

这些页面介绍产生状态的连接监督器，以及使用本命名空间的面板。

- [mcp-client](../../mcp/mcp-client/README.zh.md) — 其连接状态与重连策略正是本服务所投影的插件。
- [ui-settings-mcp](../../client/ui-settings-mcp/README.zh.md) — 渲染这些摘要的浏览器标签页。
- [Remote 组装](../remotes/README.zh.md) — 客户端如何在不导入 Host 实现的情况下使用 `mcpStatus/list`。

-----

<a id="model-experience"></a>
## 模型体验

无。该包只向浏览器提供只读的连接状态，不注册任何提示、工具或会话事件。

#### KV Cache 影响

无；该服务从不组装或发送模型提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制是该包当前的约束，用来界定状态服务与其相邻包各自负责的范围。

- **仅时点读取** — Remote 没有变更订阅；客户端需要重新读取才能看到状态转换。
- **没有控制操作** — 该服务无法重连、启用或停用服务器。`dsh-mcp-client` 的监督器没有提供按需重连。
- **失败条目的原因在 Host 日志中** — 加载失败的 Loader 条目只报告 `load-failed` 而没有信息，因为 Loader 不在 Fiber 上保留错误文本。
- **Agent 作用域的服务器没有仅配置行** — 声明在 Agent 预设内的服务器连接后才会上报；已停用或失败时没有可列出的 Loader 条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布配套检查。唯一被拥有的关系——一次注册的存续时间与创建它的插件完全一致——就是本包测试所验证的 effect 生命周期，独立检查只会重复描述同一条代码路径。
