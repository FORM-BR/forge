/** `parallelSessions` namespace dictionaries for the offered-sessions card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'parallelSessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': '建议 {n} 个并行会话',
  'row.preparing': '正在建议并行会话',
  'row.open': '打开',
  'row.openLocal': '本地',
  'row.openWorktree': 'Worktree',
  'row.opening': '正在启动…',
  'row.opened': '已打开',
  'row.failed': '无法启动会话',
  'row.pinned': '在标题栏',
  'notice.close': '关闭卡片',
  'notice.details': '查看任务说明',
  'chip.count': '{n} 个会话',
  'chip.aria': '{n} 个并行会话建议',
} satisfies Record<string, string>

/** The parallelSessions namespace key union. */
export type ParallelSessionsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'Suggested {n} parallel sessions',
  'row.preparing': 'Suggesting parallel sessions',
  'row.open': 'Open',
  'row.openLocal': 'Local',
  'row.openWorktree': 'Worktree',
  'row.opening': 'Starting…',
  'row.opened': 'Opened',
  'row.failed': 'Could not start the session',
  'row.pinned': 'In the header',
  'notice.close': 'Close card',
  'notice.details': 'Task details',
  'chip.count': '{n} sessions',
  'chip.aria': '{n} parallel sessions suggested',
} satisfies Record<ParallelSessionsKey, string>
