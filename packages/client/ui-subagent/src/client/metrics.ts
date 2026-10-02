/** Pure token, duration, and activity formatting shared by the subagent catalog and the Agent Map. */
import type { SessionProjectionMap, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

/**
 * Compact token count shared in shape with the conversation stats strip.
 * @param value - non-negative token count.
 * @param t - subagent namespace translator.
 * @returns the raw count below 1K, otherwise a K or M figure.
 */
export function formatTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/**
 * Sum the four disjoint durable provider-usage buckets.
 * @param usage - the `tokenUsage` projection value, when present.
 * @returns the total, or undefined while no usage is reported.
 */
export function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Exact whole-second active-turn duration for one catalog row.
 * @param summary - Session list row carrying the `subagentTiming` projection value.
 * @param activity - whether the row's open turn advances with the clock.
 * @param now - current epoch milliseconds for a running row.
 * @returns settled plus open-turn milliseconds, or undefined without timing.
 */
export function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/**
 * Format a duration with decreasing visual precision at larger scales.
 * @param ms - duration in milliseconds.
 * @param t - subagent namespace translator.
 * @returns the localized compact duration.
 */
export function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/**
 * Preserve exact whole seconds for hover and accessible naming.
 * @param ms - duration in milliseconds.
 * @param t - subagent namespace translator.
 * @returns the localized duration, exact to the second once it spans days.
 */
export function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}

/**
 * Format catalog-priced USD with enough decimals to keep sub-cent costs readable.
 * @param value - non-negative USD amount.
 * @returns a `$`-prefixed amount.
 */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value >= 0.1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(Math.min(8, Math.floor(-Math.log10(value)) + 2))}`
}
