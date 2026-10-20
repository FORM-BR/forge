import { useState } from 'react'
import {
  IconCompareSplitOutlineRegular, IconPlayOutlineRegular, TextShimmer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StartedToolCallViewProps, ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ParallelSessionsRow.module.css'

/** One offered session: the card's only call argument. */
export interface ParallelTask {
  readonly title: string
  readonly prompt: string
}

/** What the plugin provides to the card. */
export interface ParallelSessionsInjected {
  /**
   * Create the offered session, send its prompt, and open it in the main region.
   * @param task - the offered title and prompt.
   * @returns completion once the session is created, prompted, and opened.
   */
  startSession: (task: ParallelTask) => Promise<void>
}

type ParallelSessionsRowProps =
  ToolCallViewProps & PropsLocale<'parallelSessions'> & InjectFace<ParallelSessionsInjected>

/** Per-task outcome of the card's only gesture. */
type StartState = 'starting' | 'opened' | 'failed'

/**
 * Read the offered tasks out of the logged call arguments. A truncated streaming prefix reads as no
 * rows, which the header's count then reflects honestly.
 * @param argsRaw - the durable raw argument text.
 * @returns the offered tasks, in order.
 */
function parseTasks(argsRaw: string): ParallelTask[] {
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
function firstLine(block: StartedToolCallViewProps['block']): string | null {  if (!('kind' in block)) return null
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
 * Render one `suggest_parallel_sessions` call as the offer it is: every task with its prompt and the
 * gesture that starts it as its own session.
 * @param props - keyed toolview payload plus the card's locale seat and start action.
 * @returns the offered-sessions card.
 */
export function ParallelSessionsRow(props: ParallelSessionsRowProps) {
  if (props.phase === 'preparing') {
    return (
      <div className={css.card} data-tool="suggest_parallel_sessions" data-state="preparing">
        <div className={css.header}>
          <span className={css.leading}><IconCompareSplitOutlineRegular size={14} /></span>
          <span className={css.visuallyHidden}>{props.t('row.preparing')}</span>
          <TextShimmer active className={css.headerTitle}>{props.t('row.preparing')}</TextShimmer>
        </div>
      </div>
    )
  }
  return <OfferedSessions {...props} />
}

function OfferedSessions({ block, startSession, t }: Exclude<ParallelSessionsRowProps, { phase: 'preparing' }>) {
  const tasks = parseTasks(argsOf(block))
  const [states, setStates] = useState<Record<string, StartState>>({})
  const failed = 'kind' in block && block.isError
  const failure = failed ? firstLine(block) : null
  const start = (task: ParallelTask): void => {
    setStates(current => ({ ...current, [task.title]: 'starting' }))
    void startSession(task).then(
      () => { setStates(current => ({ ...current, [task.title]: 'opened' })) },
      () => { setStates(current => ({ ...current, [task.title]: 'failed' })) },
    )
  }
  return (
    <section className={css.card} data-tool="suggest_parallel_sessions" data-state={failed ? 'error' : 'ok'}>
      <header className={css.header}>
        <span className={css.leading}><IconCompareSplitOutlineRegular size={14} /></span>
        <span className={css.headerTitle}>{t('row.title', { n: tasks.length })}</span>
      </header>
      {failure === null ? null : <p className={css.failure}>{failure}</p>}
      {failure !== null || tasks.length === 0 ? null : (
        <ul className={css.tasks}>
          {tasks.map((task) => {
            const state = states[task.title]
            const label = state === 'starting'
              ? t('row.opening')
              : state === 'opened' ? t('row.opened') : t('row.open')
            return (
              <li key={task.title} className={css.task}>
                <span className={css.taskText}>
                  <span className={css.taskTitle}>{task.title}</span>
                  <span className={css.taskPrompt}>{task.prompt}</span>
                </span>
                <button
                  type="button"
                  className={css.open}
                  data-state={state ?? 'idle'}
                  disabled={state === 'starting' || state === 'opened'}
                  onClick={() => { start(task) }}
                >
                  <IconPlayOutlineRegular size={12} />
                  {label}
                </button>
                {state === 'failed' ? <span className={css.taskError}>{t('row.failed')}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
