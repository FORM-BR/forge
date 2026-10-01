/** Texto da central de avisos de fim de turno. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    turnNotify: keyof typeof zh
  }
}

/** Central de avisos em chinês simplificado. */
export const zh = {
  bell: '任务提醒',
  title: '任务提醒',
  empty: '还没有提醒。会话完成或需要你确认时，会显示在这里。',
  done: '本轮已结束',
  attention: '需要你处理',
  'system.done': '本轮已结束，请查看结果',
  'system.attention': '正在等待你的确认',
  'ago.now': '刚刚',
  'ago.minutes': '{n} 分钟前',
  'ago.hours': '{n} 小时前',
  'ago.days': '{n} 天前',
  'pref.enabled': '启用提醒',
  'pref.sound': '提示音',
  'pref.system': '系统通知（窗口在后台时）',
  'pref.onlyUnseen': '正在查看该会话时不提醒',
  'hint.blocked': '浏览器已阻止通知。请在地址栏的站点设置中允许后再开启。',
  'hint.unsupported': '当前环境不支持系统通知。',
  markRead: '全部标为已读',
  clear: '清空',
  unread: '{n} 条未读',
} satisfies Record<string, string>

/** Central de avisos em inglês. */
export const en = {
  bell: 'Task alerts',
  title: 'Task alerts',
  empty: 'No alerts yet. A session that finishes or needs your input shows up here.',
  done: 'Turn ended',
  attention: 'Needs your input',
  'system.done': 'Turn ended — check the result',
  'system.attention': 'Waiting for your input',
  'ago.now': 'just now',
  'ago.minutes': '{n} min ago',
  'ago.hours': '{n} h ago',
  'ago.days': '{n} d ago',
  'pref.enabled': 'Alerts on',
  'pref.sound': 'Sound',
  'pref.system': 'System notifications (when the window is in the background)',
  'pref.onlyUnseen': "Skip alerts for the session I'm looking at",
  'hint.blocked': 'The browser blocked notifications. Allow them in the site settings next to the address bar, then turn this on.',
  'hint.unsupported': 'System notifications are not supported here.',
  markRead: 'Mark all read',
  clear: 'Clear',
  unread: '{n} unread',
} satisfies Record<string, string>
