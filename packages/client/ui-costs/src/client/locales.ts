/** Copy owned by the sidebar costs feature. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebarCosts: keyof typeof zh
  }
}

/** Simplified Chinese costs panel copy. */
export const zh = {
  title: '费用',
  description: '按会话、模型和日期估算的 API 费用',
  session: '当前会话',
  history: '历史记录',
  total: '总额',
  attempts: '调用次数',
  unpriced: '未定价',
  byModel: '按模型',
  byDay: '按日期',
  model: '模型',
  provider: '提供商',
  day: '日期',
  cost: '费用',
  inputTokens: '输入',
  outputTokens: '输出',
  loading: '正在读取费用…',
  empty: '暂无可用的费用记录。',
  failed: '读取费用失败：{message}',
  retry: '重试',
  estimate: '根据本地价格目录估算，仅供参考，不构成账单。',
  emptyTable: '暂无记录',
} satisfies Record<string, string>

/** English costs panel copy. */
export const en = {
  title: 'Costs',
  description: 'Estimated API cost by session, model and day',
  session: 'Current session',
  history: 'History',
  total: 'Total',
  attempts: 'Attempts',
  unpriced: 'Unpriced',
  byModel: 'By model',
  byDay: 'By day',
  model: 'Model',
  provider: 'Provider',
  day: 'Day',
  cost: 'Cost',
  inputTokens: 'Input',
  outputTokens: 'Output',
  loading: 'Loading costs…',
  empty: 'No cost records yet.',
  failed: 'Failed to read costs: {message}',
  retry: 'Retry',
  estimate: 'Estimated from the local price catalog; informational only, not an invoice.',
  emptyTable: 'No records',
} satisfies Record<keyof typeof zh, string>
