---
description: "已配置 MCP 服务器的 Host Remote 负责方：通过生成的 mcpStatus 命名空间提供每个服务器的无密钥摘要（状态、传输方式、主机、工具数量、最近一次错误、隐藏取值的定义），在配置档补丁中添加、修改、启停和删除 dsh-mcp-client 条目，并作为 dsh-mcp-client 插件上报状态的注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mcp-status

[English](README.md) | 中文

该 Remote BFF 运行在 Host 进程中。读取是实时状态的投影；写入只会通过配置编辑器修改配置档补丁中的 `dsh-mcp-client` 条目。

## 概述

MCP 状态 Remote BFF 让浏览器能够看到当前接入了什么。它暴露一个 Typert 命名空间 `mcpStatus`，其 `list` 方法为每个已配置的 MCP 服务器返回一条摘要：名称、传输方式、端点主机、四种状态之一（`connecting`、`connected`、`error`、`disabled`）、已同步的工具数量，以及最近一次失败信息。同一个服务也是 `mcpServerStatus` 注册表，每个 [`dsh-mcp-client`](../../mcp/mcp-client/README.zh.md) 插件都向它上报状态。摘要中从不包含 `env` 或 header 的取值、形似密钥的参数，也不包含 URL 凭据和查询值。同一命名空间还能在配置档补丁中添加、修改、启停和删除服务器（`save`、`setEnabled`、`removeServer`），并用文本编辑器打开补丁文件（`openConfigFile`）；密钥只会流向 Host，已保存的值从不返回。

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

### 定义存放在哪里

`list()` 还会读取补丁文件，并按 `serverName` 把每个 `dsh-mcp-client` 条目与对应服务器合并。摘要随之带有 `source`（`profile` 或 `home`；来自内置包或命令行层时缺省）、已保存但 Loader 尚未挂载的条目的 `pendingRestart`，以及 `config`：条目 `id`、`disabled`、表单能否编辑、命令、参数、URL，以及环境变量和请求头的**名称**。凭据名选项之后的参数、凭据名的 `NAME=value` 赋值和形似凭据的令牌都会替换为圆点，URL 的用户信息、查询值和不透明路径段也一样。`management` 说明配置档能否编辑（`writable`，或 `safe-mode`、`no-profile` 之一的 `readOnlyReason`），并给出两个文件路径（主目录以缩写显示）。

### 在面板中编辑

只有配置档补丁中的条目可写；定义在用户级 `~/.dsh/cordis.patch.yml`、内置包或命令行叠加层中的服务器是只读的，会返回 `mcpStatus/read-only`。

- `save(draft, id)` 添加服务器（不带 `id`），作为独立的 `insert` 项，id 为 `mcp-<名称>`；或替换已有条目中由表单负责的字段。取值为 `null` 的 env 或 header、`null` 的 URL，以及以 `{ keep: index }` 发送的参数会保留已存的节点，因此未改动的密钥无需重新输入；草稿中省略的键会被移除。名称须匹配 `[A-Za-z0-9_-]{1,32}` 且未被占用；不合法的提交返回 `mcpStatus/invalid` 并指出字段。
- `setEnabled(id, enabled)` 设置或清除条目的 `disabled`；`removeServer(id)` 删除条目，并删除因此变空的 `insert` 项。条目已不存在时返回 `mcpStatus/not-found`。
- `openConfigFile('profile' | 'home')` 用原生编辑器打开文件。

每次写入都经由 `ctx.configEditor.editDocument`：它持有配置档锁和 HMR 互斥，原子写入文件，并就地重新加载配置档。重新加载失败会回滚，并返回 `mcpStatus/apply-failed` 及已清除所提交密钥的原因。结果为 `applied`；若约八秒后服务器仍在启动则为 `pending`（重新加载在后台完成，失败时仍会回滚）；Host 无法就地重新加载时为 `restart-required`。编辑会保留注释以及表单不负责的所有字段，例如 `cwd`、`reconnect` 和 `!!js` 表达式；表单字段中含表达式的条目只能启停或删除，不能编辑。

### Agent 工具

`@deepseek-ai/dsh-api-mcp-status/tool` 入口注册 `mcp_servers`，这是一个只读工具，返回与 `list()` 相同的快照。随附的 `mcp` Agent 预设挂载了它，使其助手能读取面板所显示的状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`McpStatusService` 继承 `TypertRemoteService`，服务键为 `mcpServerStatus`，线路命名空间为 `mcpStatus`。`register(source)` 通过调用方插件拥有的 effect 添加一个 `McpServerStatusSource`，因此 MCP 插件重载或销毁时，它的行会随之移除。`list()` 调用每个来源的 `status()`，并在每次调用时读取 Loader；没有任何缓存，响应始终反映当前状态。

`mcpServerStatus` 这个 Context 键以及来源和注册表类型由 `dsh-mcp-client` 声明，使该包无需依赖本包。`src/types.ts` 只包含可用于浏览器的线路类型声明。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `McpStatusService`：注册表、`list`、`save`、`setEnabled`、`removeServer`、`openConfigFile` 这些 Remote，以及与 Loader 和补丁文件的合并 |
| [`src/patch-file.ts`](src/patch-file.ts) | 对补丁文件文本中 `dsh-mcp-client` 条目的纯函数式、保留注释的编辑 |
| [`src/mask.ts`](src/mask.ts) | 参数与 URL 的显示脱敏，以及从消息中清除所提交的密钥 |
| [`src/tool.ts`](src/tool.ts) | `mcp_servers` Agent 工具 |
| [`src/types.ts`](src/types.ts) | 线路类型：摘要、定义视图、草稿、管理状态与错误码 |

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

### MCP 服务器工具

#### 模型看到什么

[`mcp_servers` 工具](../../../docs/tool-catalog.zh.md#deepseek-aidsh-api-mcp-status)返回与设置面板相同的无密钥快照：每个服务器的状态、传输方式、工具数量、最近一次错误、定义来源，以及隐藏了所有密钥取值的配置视图。它不带参数，不改动任何内容，也不注入消息。只有挂载 `/tool` 入口的预设才带有它；随附的 `mcp` 预设就是如此。

#### Token 影响

装配工具消费者时提供工具声明；每次调用追加一份 JSON 快照，其大小随已配置服务器数量增长。

#### KV Cache 影响

工具声明是固定的，因此挂载它不会让各轮之间的缓存前缀发生移动。结果与其他工具结果一样追加到对话中。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制是该包当前的约束，用来界定状态服务与其相邻包各自负责的范围。

- **仅时点读取** — Remote 没有变更订阅；客户端需要重新读取才能看到状态转换。
- **没有重连操作** — 该服务可以关闭和重新开启配置档中的服务器，但无法就地重连；`dsh-mcp-client` 的监督器没有提供按需重连。
- **仅限配置档条目** — 定义在用户级补丁、内置包或命令行叠加层中的服务器只读列出；要修改它们需要编辑对应文件。
- **热重载需要根 Include 条目** — 没有该条目启动的 Host 会保留已写入的文件并返回 `restart-required`。
- **失败条目的原因在 Host 日志中** — 加载失败的 Loader 条目只报告 `load-failed` 而没有信息，因为 Loader 不在 Fiber 上保留错误文本。
- **Agent 作用域的服务器没有仅配置行** — 声明在 Agent 预设内的服务器连接后才会上报；已停用或失败时没有可列出的 Loader 条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布配套检查。唯一被拥有的关系——一次注册的存续时间与创建它的插件完全一致——就是本包测试所验证的 effect 生命周期，独立检查只会重复描述同一条代码路径。
