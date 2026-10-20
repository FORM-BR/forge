/** `parallelSessions` namespace dictionaries for the offered-sessions card. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'parallelSessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': '建议 {n} 个并行会话',
  'row.preparing': '正在建议并行会话',
  'row.open': '打开',
  'row.openLocal': '在本工作区打开',
  'row.openWorktree': '在 git worktree 中打开',
  'row.opening': '正在启动…',
  'row.opened': '已打开',
  'row.failed': '无法启动会话',
} satisfies Record<string, string>

/** The parallelSessions namespace key union. */
export type ParallelSessionsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'Suggested {n} parallel sessions',
  'row.preparing': 'Suggesting parallel sessions',
  'row.open': 'Open',
  'row.openLocal': 'Open in this workspace',
  'row.openWorktree': 'Open in a git worktree',
  'row.opening': 'Starting…',
  'row.opened': 'Opened',
  'row.failed': 'Could not start the session',
} satisfies Record<ParallelSessionsKey, string>
