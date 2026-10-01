/** Copy owned by the cost report panel feature. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    costReport: keyof typeof zh
  }
}

/** Simplified Chinese cost report panel copy. */
export const zh = {
  panel: '费用',
  from: '开始',
  to: '结束',
  workspace: '工作区',
  model: '模型',
  all: '全部',
  total: '总费用',
  attempts: '调用次数',
  inputTokens: '输入 tokens',
  outputTokens: '输出 tokens',
  dailyCost: '每日费用',
  sessions: '会话',
  session: '会话',
  day: '日期',
  cost: '费用',
  loading: '正在读取费用报告…',
  empty: '没有符合条件的费用记录。',
  failed: '读取费用失败：{message}',
  retry: '重试',
  estimate: '根据本地价格目录估算，仅供参考，不构成账单。',
} satisfies Record<string, string>

/** English cost report panel copy. */
export const en = {
  panel: 'Costs',
  from: 'From',
  to: 'To',
  workspace: 'Workspace',
  model: 'Model',
  all: 'All',
  total: 'Total cost',
  attempts: 'Attempts',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  dailyCost: 'Daily cost',
  sessions: 'Sessions',
  session: 'Session',
  day: 'Day',
  cost: 'Cost',
  loading: 'Loading cost report…',
  empty: 'No cost records match the filters.',
  failed: 'Failed to read costs: {message}',
  retry: 'Retry',
  estimate: 'Estimated from the local price catalog; informational only, not an invoice.',
} satisfies Record<keyof typeof zh, string>

/** All panel copy keys, for typed lookups in component helpers. */
export type CostReportLocaleKey = keyof typeof zh