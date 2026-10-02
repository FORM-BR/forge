---
description: "在 Web 中选择 Agent preset 和新任务默认值，查看各模式的说明与声明的配置。创建与修改引导至创造模式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

[English](README.md) | 中文

## 概述

在 Web 中选择 Agent preset 和新任务默认值，查看各模式的说明与声明的配置。创建与修改引导至创造模式。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

设置页显示内置与自定义卡片分组、默认项高亮和点击卡片选择；没有 preset 的分组不显示，但自定义分组会保留其创造入口。每张卡片都提供「查看配置」，以只读 YAML 打开该 preset 声明的插件列表，使用 Loader 自己的方言（含 `!!js` 条件）；加载失败的 preset 同样可读，因为其诊断信息正指向这份 YAML。Escape 只关闭查看器并将焦点还给卡片；离开设置页会清空查看器，迟到的读取结果不会重新打开它。本页不编辑任何内容：创造入口启动一个创造模式任务，以 bundle 形式创建或覆盖 preset；当 `cordis` preset 在列表中且存在会话流程时提供。

通用设置中的代码工作工具决定能否选择模式：关闭后新会话选择器消失、卡片拒绝选择，而已保存的默认值继续用于新任务。选择健康定义作为默认值也会同步当前新任务页面的空白会话。Creator 入口开启一个使用 `cordis` preset 的新任务。同一套“预设并启动”的流程也以 `ctx.agentPresetLauncher`（`available()` 与 `start(presetId)`）的形式提供给其他需要在随附 preset 上启动任务的界面，例如 MCP 服务器标签页；它只在会话流程存在期间存在。

工作区可以带有业务配置：把一个 Agent preset 绑定到它的目录。工作区「...」菜单中有「工作区方案」分组，在其中选择「无」或某个健康的 preset 即保存绑定。工作区标题后的徽标显示该 preset；已被移除或加载失败的 preset 以删除线显示其 id。之后在该工作区打开的下一个空白会话，会像在新任务选择器上点选一样，以方案的 preset 启动。在会话上手动选择的 preset 对该会话优先于方案；方案之后被修改，会影响仍为空白且未手动选择的会话；方案指向不可用的 preset 时保留默认值。菜单项、徽标与方案的应用都受代码工作工具开关控制。方案携带其 preset 所组合的全部内容：提示词人设行、技能与工具；模型、权限默认值和插件集仍是整个部署共用。

已知的内置预设提供只读的模式说明与使用示例对话框。各页签保留各自的滚动位置；关闭后焦点回到打开它的操作。帮助不会改变新任务默认值。默认徽标取代卡片的分组徽标，预设 id 显示在标题旁。指南文案与示例归本包所有。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`agentPresets/list` 提供列表并标记当前默认值，`agentPresets/read` 为查看器提供一条声明的 YAML；默认值的修改写入 `agent-preset-registry` settings 命名空间。选择器、空白会话同步和只读会话标签使用记录的 preset 标识。连接重置和设置更新会刷新列表。列表还携带 `workspacePresets`，即从工作区目录路径到 preset id 的方案映射；它保存在同一 settings 条目的 volatile 字段 `workspacePresets` 中，每次修改是一次按路径寻址的 `settings.mutate` 写入。新会话座位通过工作区快照解析会话所属的工作区（先看归属，再以 `cwd` 兜底），并像处理手动选择一样暂存方案；它按会话记住用户的选择和最近应用的方案值，因此被拒绝的方案不会重试。菜单项与徽标填入工作区浏览器声明的 `sidebar.workspaces.workspace.menu.item` 与 `sidebar.workspaces.workspace.badge` 座位。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Scope](../../core/scope/README.zh.md) — 注册隔离。
- [Agent](../../core/agent/README.zh.md) — 会话运行时。
- [Cordis](../../../docs/cordis-primer.zh.md) — 插件配置与生命周期。

<a id="model-experience"></a>
## 模型体验

通过选定的 preset 间接影响模型，其插件拥有模型可见能力。

#### KV Cache effect

选择变更只影响之后的任务，已有插件与提示词保持不变。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- 方案只选择 preset，不涉及其他：模型、权限默认值和已安装插件仍是全局的，因此第三方插件无法按工作区区分。它在 Web UI 中于空白会话打开时生效；由其他调用方创建的会话以默认值启动。
- Web 不创建也不编辑 preset：配置查看器是只读的；通过创造模式安装的 bundle 声明新 preset，或按行 id 覆盖内置 preset，覆盖会替换整个子插件列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion；状态由 Host 注册表拥有，客户端展示与选择行为由组件测试验证。
