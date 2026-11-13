---
description: "ctx.web 的 Tavily 搜索提供方：部署方如何挂载厂商原生 web 搜索，获得提取 snippet 与生成答案。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-tavily

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-tavily`，harness 可以通过 Tavily 搜索 web，获得带提取页面 snippet、发布日期与可选生成答案的厂商原生结果。当部署持有 Tavily API 密钥、并希望使用 Tavily 的 `basic` 或 `advanced` 搜索时选择它。没有 URL 的来源会被丢弃，因此一次调用返回的来源可能少于请求数量。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

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

在已加载 web 服务的组合中挂载本提供方；它以 `tavily` 搜索提供方身份注册，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——也可以用 `searchProvider: tavily` 固定。

### 何时选择

当部署持有 Tavily API 密钥，并希望使用 Tavily 的内容提取搜索、获得每项结果的 snippet、发布日期与生成答案摘要时，选择此后端。密钥为空且没有凭据解析器、或端点基址无法解析时，提供方不可用——每次搜索调用都会以结构化错误失败。

### 最小配置

加载 web 服务与本提供方；API 密钥回退到启动环境中的 `$TAVILY_API_KEY`，其余设置都有安全默认值。挂载凭据服务时，密钥按次搜索解析——用 web Models 页面存入密钥，无需重启。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-tavily'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | `$TAVILY_API_KEY` | Tavily API 密钥；为空或缺失、且没有凭据服务提供时，提供方不可用 |
| `apiKeyEnv` | `TAVILY_API_KEY` | 每次搜索解析的凭据引用；缺失凭据的诊断会点名它 |
| `baseURL` | `https://api.tavily.com` | 端点基址；追加 `/search`。`$TAVILY_BASE_URL` 可覆盖。无法解析时提供方不可用 |
| `searchDepth` | `basic` | 以 Tavily `search_depth` 发送的检索深度：`basic` 每次搜索耗 1 credit，`advanced` 耗 2 |
| `maxResults` | （未设置） | 请求不含 `maxResults` 时使用的默认结果数；必须是正整数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-tavily)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 搜索返回什么

每项 Tavily 结果映射为 `WebSearchSource`：`url`、`title`、提取页面 `content` 作为 `snippet`、`published_date` 作为 `publishedAt`；没有 URL 的来源会被丢弃。可选的生成 `answer` 成为结果级 `content`。请求的 `maxResults` 优先于已配置的默认 `maxResults`，并作为成本与延迟优化发送给 Tavily——最终上限由服务强制执行：截断并标记。

### 失败与恢复

提供方失败——HTTP 错误、网络失败、响应体无法解析或结构不符——以 `WebError` `WEB_PROVIDER_ERROR` 呈现；中止请求以 `WEB_ABORTED` 呈现；密钥解析为空的搜索以 `WEB_PROVIDER_CREDENTIAL_MISSING` 呈现，并点名凭据引用。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。调用方根据错误码进行分流；面向模型的 `web_search` 工具会在自己的错误包装层内把失败呈现给模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该提供方是 Tavily API 之上的薄适配器，遵循两条刻意的规则：

- **密钥是按操作的状态，不是提供方状态。** 挂载凭据服务时插件会接入凭据解析器，运行时存入的密钥（web Models 页面写入）无需重新注册就能到达下一次搜索；没有该服务时，启动环境被即时解析，缺失密钥在此即为定论——seam 报告提供方不可用，而不是每次搜索都在分发时失败。
- **提取内容即 snippet。** Tavily 在同一次调用中提取页面内容，`content` 直接映射为 `snippet`；生成 `answer` 是唯一的结果级 `content`，绝不从其他字段捏造。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、凭据平面接线、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `TavilySearchProvider`：密钥解析、请求分发、中止分类、结果映射 |
| [`src/types.ts`](src/types.ts) | Tavily 协议类型：`TavilySearchRequest`、`TavilySearchResponse`、`TavilyResult`、`TavilyError` |
| — | 不发布运行时不变量配套入口；除所属 seam 强制执行的约定外，本包没有独立的事件序列或可变数据关系。 |

### 请求与映射流程

`search()` 以 `redirect: 'error'` 把查询、搜索深度、include 开关与可选结果数 POST 到 `{baseURL}/search`，因此重定向会在不接触目标的情况下使请求失败。解析后的 `results[]` 逐项映射，没有 URL 的条目被丢弃，服务在返回路径上应用最终的 `maxResults` 上限。中止——名为 `AbortError` 的 `DOMException`——变为 `WEB_ABORTED`；其余情况变为 `WEB_PROVIDER_ERROR`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入服务、面向模型的工具与设计依据。

- [web 子系统](../../../docs/subsystems/web.zh.md)——穷尽式的搜索请求／结果词汇与错误码。
- [web 包映射](../README.zh.md)——web 包家族与各角色。
- [dsh-web](../web/README.zh.md)——本提供方注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md)——渲染本提供方来源的面向模型 `web_search` 工具。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-tavily)——每个受支持配置字段及其源声明。
- [web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——搜索与抓取为何共用一项提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-web` 间接影响模型体验。该工具保留本提供方经 `maxResults` 限制的 URL、标题、提取 snippet、发布日期与生成答案；如果发生失败，则会在消费方的错误包装层内保留原样错误消息 `Tavily search aborted`、`Tavily search request failed: <error>` 和 `Tavily returned an unprocessable response body: <error>`。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明提供方在哪些情况下不合适。它们是当前包约束。

- **没有 URL 的来源会被整个丢弃**——URL 是 seam 来源唯一的必填字段，因此返回来源可能少于请求数量。
- **只公开 `searchDepth`／`maxResults`**——Tavily 的其他控制项（域名包含／排除、时间范围、topic、逐结果原始内容）等待提供方无关的服务字段（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)）。
- **按错误形状分类中止**——只有名为 `AbortError` 的 `DOMException` 才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）呈现为 `WEB_PROVIDER_ERROR`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文和相关 Agent Note 为准。

#### 未来：更宽的 Tavily 控制面

Tavily 的域名包含／排除、时间范围、topic 与原始内容控制项仍未公开。公开它们需要先有提供方无关的服务字段，让家族以一个协调一致的控制项、而非厂商专有参数的方式新增。

</details>
