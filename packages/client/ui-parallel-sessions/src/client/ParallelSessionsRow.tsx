import { useEffect, useRef } from 'react'
import { IconCompareSplitOutlineRegular, TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StartedToolCallViewProps, ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ParallelOffer, ParallelTask } from './offer-store.ts'
import css from './ParallelSessionsRow.module.css'

/** What the plugin provides to the transcript row. */
export interface ParallelSessionsInjected {
  /**
   * Hand the offered tasks to the card pinned above the transcript. The offer exists only in this
   * logged call, so the row that renders the call is what publishes it.
   * @param offer - the call identity and its tasks.
   */
  publishOffer: (offer: ParallelOffer) => void
  /** Drop the offer when the row leaves the transcript or stops carrying tasks. */
  clearOffer: () => void
}

type ParallelSessionsRowProps =
  ToolCallViewProps & PropsLocale<'parallelSessions'> & InjectFace<ParallelSessionsInjected>

/**
 * Read the offered tasks out of the logged call arguments. A truncated streaming prefix reads as no
 * rows, which the header's count then reflects honestly.
 * @param argsRaw - the durable raw argument text.
 * @returns the offered tasks, in order.
 */
export function parseTasks(argsRaw: string): ParallelTask[] {
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const tasks = (parsed as { tasks?: unknown }).tasks
    if (!Array.isArray(tasks)) return []
    return tasks.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { title, prompt } = item as { title?: unknown; prompt?: unknown }
      return typeof title === 'string' && typeof prompt === 'string' && title !== '' && prompt !== ''
        ? [{ title, prompt }]
        : []
    })
  } catch {
    // Streaming exposes a truncated JSON prefix; showing no rows beats inventing one.
    return []
  }
}

/**
 * The call's raw argument text, whichever side of the call the block is on: a running call holds
 * `argsRaw` directly, a settled result node holds it on its `call`.
 * @param block - the running call or settled result.
 * @returns the raw argument text, empty when the call carried none.
 */
function argsOf(block: StartedToolCallViewProps['block']): string {
  return 'kind' in block ? block.call?.argsRaw ?? '' : block.argsRaw
}

/** First physical line of the durable result text, as the failure summary. */
function firstLine(block: StartedToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  const text = parts.join('\n')
  const newline = text.indexOf('\n')
  return text === '' ? null : newline === -1 ? text : text.slice(0, newline)
}

/**
 * Render one `suggest_parallel_sessions` call as the trace it leaves: the count and where the
 * actionable card sits. The tasks and their start gestures belong to that card, so this row never
 * repeats them.
 * @param props - keyed toolview payload plus the card's locale seat and published offer.
 * @returns the offer's transcript line.
 */
export function ParallelSessionsRow(props: ParallelSessionsRowProps) {
  if (props.phase === 'preparing') {
    return (
      <div className={css.row} data-tool="suggest_parallel_sessions" data-state="preparing">
        <span className={css.leading}><IconCompareSplitOutlineRegular size={14} /></span>
        <span className={css.visuallyHidden}>{props.t('row.preparing')}</span>
        <TextShimmer active className={css.title}>{props.t('row.preparing')}</TextShimmer>
      </div>
    )
  }
  return <SettledRow {...props} />
}

function SettledRow({ callId, block, publishOffer, clearOffer, t }: Exclude<ParallelSessionsRowProps, { phase: 'preparing' }>) {
  const tasks = parseTasks(argsOf(block))
  const failure = 'kind' in block && block.isError ? firstLine(block) : null
  const titles = tasks.map(task => task.title).join('\n')
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  useEffect(() => {
    if (failure !== null || tasksRef.current.length === 0) return
    publishOffer({ callId, tasks: tasksRef.current })
    return () => { clearOffer() }
    // Republish only when the call identity or its task list changes; the offer store
    // ignores a call it already holds.
  }, [callId, titles, failure, publishOffer, clearOffer])
  return (
    <div className={css.row} data-tool="suggest_parallel_sessions" data-state={failure === null ? 'ok' : 'error'}>
      <span className={css.leading}><IconCompareSplitOutlineRegular size={14} /></span>
      <span className={css.title}>{t('row.title', { n: tasks.length })}</span>
      {failure === null && tasks.length > 0 ? <span className={css.hint}>{t('row.pinned')}</span> : null}
      {failure === null ? null : <p className={css.failure}>{failure}</p>}
    </div>
  )
}
