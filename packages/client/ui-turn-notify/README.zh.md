---
description: "FORGE 的浮动通知铃：会话结束或等待用户时播放提示音、发送系统通知，并在标签页标题中显示计数，适合同时运行多个会话。"
kind: "package"
---

# ui-turn-notify — 轮次结束通知中心

[English](README.md) | 中文

## 用途

同时运行多个会话时（FORGE 在后台干活而你忙别的事），很容易把某个会话晾在等待审批或已经结束的状态。这个插件会提醒你：

- **已完成** —— 会话停止运行且没有待处理请求。
- **需要你** —— 出现待审批或向用户提问的问题。

每次通知按偏好触发：短提示音（“已完成”双音，“需要你”三声）、系统通知（仅窗口在后台时）和选项卡标题中的 `(N)` 计数。最近的通知汇总在右下角的**铃铛**里，点击可打开对应会话。

## 通知规则

- 首次读取只建立基线：打开应用不会通知旧会话。
- 子智能体不通知（由父级通知）。
- 窗口有焦点**且**会话已在屏幕上打开时不通知（偏好“当我已经在看就不打扰”）。
- 在焦点下打开会话会把该会话的待定通知标为已读；关闭面板则全部标已读。
- 最多保留 30 条通知，最新的在前。

## 偏好

保存在浏览器的 `localStorage`（键 `forge.turnNotify.prefs.v1`）：通知开关、声音、系统通知、“仅不在看时”。开启系统通知会在点击时请求浏览器权限；若被拒绝，面板会说明如何放开。

## 结构

| 文件 | 作用 |
|---|---|
| `src/client/controller.ts` | 状态转移检测、通知策略、偏好。纯逻辑，无 DOM。 |
| `src/client/effects.ts` | 真实副作用：WebAudio、`Notification`、选项卡标题。 |
| `src/client/TurnNotifyHost.tsx` | 铃铛、通知列表与快捷键（入口在 `shell.overlay`）。 |
| `src/client/index.ts` | `apply`：注册 `turnNotify` 词典（en/zh）与 slot。 |

读取 `useSessionStatus`（字段 `running` 与 `pendingInteraction`）和 `useSessions`；通过 `ctx.uiWorkspace.openSession` 导航。不触碰 Host，也不依赖其他插件。

## 已知限制

- 通知显示 "Turn ended"（轮次结束），不区分成功还是失败：客户端没有全局错误信号，所以出错收尾的轮次也会触发同样的通知。打开会话查看结果。
- 文本仅 en/zh（FORGE 当前内置的两种语言）。
- 偏好保存在浏览器 `localStorage`，按设备生效。

## 测试

```sh
pnpm vitest run packages/client/ui-turn-notify
```
