---
description: "dsh Web 客户端设置中的只读 MCP 服务器标签页：展示每个已配置 MCP 服务器的连接状态、传输方式、端点主机、工具数量与最近一次错误；没有配置任何服务器时，空状态会指出在哪里配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

## 概述

**MCP 服务器**标签页让 Web 用户看到接入了哪些 MCP 服务器、是否正常工作。每个服务器一行，显示名称、传输方式（Streamable HTTP 还显示端点主机）、工具数量和状态徽标：连接中、已连接、出错或已停用。出错的服务器会显示最近一次错误、重连尝试计数，或停止重试的原因。没有配置任何服务器时，标签页会说明这一点，并给出一条最小的 `cordis.patch.yml` 条目。Host 从不发送 `env`、header、参数与 URL 细节，因此标签页无从展示它们。

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

打开设置中的「插件」分区并选择 **MCP 服务器**标签页。插件激活期间不会读取 Remote：首次选择该标签页时才挂载组件，并通过 `api-remotes` 调用 `ctx.remote.mcpStatus.list()`。

### 阅读一行

状态徽标在尝试进行时为“连接中”，工具同步完成后为“已连接”，失败后为“出错”，配置中被关闭的条目为“已停用”。“出错”行显示最近一次失败信息；重试已排期时显示“正在重连，第 N/M 次尝试”；之后不会再重试时给出原因：自动重连已关闭、重试预算已用完、旧连接未能确认关闭，或插件启动失败。失去连接的服务器保留最后已知的工具数量。

### 刷新

标签页可通过**刷新**按钮按需刷新。只要有服务器处于连接中或有重试待执行，它还会每三秒重新读取一次且不会清空列表，所有服务器稳定后即停止。读取失败时显示共享的错误标记和重试按钮。

### 配置服务器

空状态指向配置档的 `cordis.patch.yml`，并为每个服务器展示一条 `dsh-mcp-client` 条目。每个字段见 [mcp-client](../../mcp/mcp-client/README.zh.md)。想在没有真实服务的情况下试用该面板，可让一条 stdio 条目指向 `@modelcontextprotocol/server-everything`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

标签页是 Host 持有的快照的只读投影。浏览器插件注册一个本地化的 `settings.plugins.tab` 贡献，id 为 `mcp`，排在插件列表之后；导航条目与标签页外框归「插件」分区所有。注册使用 `ctx.slots.inject()`，因此无需导入分区所有者，就能跟随标签页的晚声明、重新声明、语言切换与销毁。

行以 Host 给出的 `key` 为键，所以同名的两个服务器保持区分。后台刷新是每次读取完成后重新设置的定时器，且仅在快照中存在连接中的服务器或待执行的重试时才会设置。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面涵盖设置分区、远程调用与 Host 侧投影。

- [ui-settings-plugins](../ui-settings-plugins/README.zh.md)——该标签页注册进入的「插件」分区。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.plugins.tab` 的设置领域基础层。
- [api-remotes](../../api/remotes/README.zh.md)——`mcpStatus.list()` 背后的 Remote BFF 层。
- [api-mcp-status](../../api/mcp-status/README.zh.md)——该标签页所渲染的 Host 侧状态投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器侧的状态投影，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


以下限制界定状态视图的新鲜度与范围；它们是当前包的约束。

- **轮询而非推送**：Host 没有提供变更事件，所以视图只在有未稳定项时重新读取，其余时候按需读取。
- **只读**：标签页没有重连、启用或停用操作；`dsh-mcp-client` 没有可供调用的按需重连。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包拥有一个只读的设置贡献。
