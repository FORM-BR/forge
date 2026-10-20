import { useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconCompareSplitOutlineRegular, IconPlayOutlineRegular,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ParallelOfferSource, ParallelStartMode, ParallelTask } from './offer-store.ts'
import css from './ParallelSessionsNotice.module.css'

/** What the plugin provides to the pinned card. */
export interface ParallelSessionsNoticeInjected {
  hooks: {
    /** Offers by Session, published by the transcript row that renders the call. */
    parallelOffer: ParallelOfferSource
  }
  /**
   * Create the offered session, send its prompt, and open it in the main region.
   * @param task - the offered title and prompt.
   * @param mode - run in the offering workspace, or in a new git worktree beside it.
   * @returns completion once the session is created, prompted, and opened.
   */
  startSession: (task: ParallelTask, mode: ParallelStartMode) => Promise<void>
  /** Hide the whole offer without starting anything. */
  dismiss: () => void
  /**
   * Drop one started task from the offer, so the card lists only what is still available.
   * @param title - the started task's title.
   */
  settle: (title: string) => void
}

/** Full props of the pinned offer card: chain runtime, the card's copy, and the injected offer. */
export type ParallelSessionsNoticeProps =
  PropsRuntime<'conversation.notice'>
  & PropsLocale<'parallelSessions'>
  & InjectFace<ParallelSessionsNoticeInjected>

/** Per-task outcome of the card's only gesture. */
type StartState = 'starting' | 'opened' | 'failed'

/**
 * Render the offered sessions as a card pinned above the transcript: every task with its prompt
 * and the gesture that starts it as its own session. It renders nothing while the Session holds no
 * offer, which keeps the notice seat empty for the question card.
 * @param props - chain runtime, locale seat, and the published offer.
 * @returns the pinned card, or null when this Session has no pending offer.
 */
export function ParallelSessionsNotice(props: ParallelSessionsNoticeProps) {
  const sessionId = props.sessionId
  const offer = props.useParallelOffer(offers => sessionId === undefined ? undefined : offers.get(sessionId))
  const [states, setStates] = useState<Record<string, StartState>>({})
  const [menuTask, setMenuTask] = useState<string | null>(null)
  if (offer === undefined || offer.tasks.length === 0) return null
  const start = (task: ParallelTask, mode: ParallelStartMode): void => {
    setStates(current => ({ ...current, [task.title]: 'starting' }))
    void props.startSession(task, mode).then(
      () => {
        setStates(current => ({ ...current, [task.title]: 'opened' }))
        props.settle(task.title)
      },
      () => { setStates(current => ({ ...current, [task.title]: 'failed' })) },
    )
  }
  return (
    <section className={css.card} data-tool="suggest_parallel_sessions" aria-label={props.t('row.title', { n: offer.tasks.length })}>
      <header className={css.header}>
        <span className={css.leading}><IconCompareSplitOutlineRegular size={14} /></span>
        <span className={css.title}>{props.t('row.title', { n: offer.tasks.length })}</span>
        <button
          type="button"
          className={css.close}
          aria-label={props.t('notice.close')}
          onClick={() => { props.dismiss() }}
        >
          <IconCloseOutlineRegular size={14} />
        </button>
      </header>
      <ul className={css.tasks}>
        {offer.tasks.map((task) => {
          const state = states[task.title]
          const label = state === 'starting'
            ? props.t('row.opening')
            : state === 'opened' ? props.t('row.opened') : props.t('row.open')
          return (
            <li key={task.title} className={css.task}>
              <span className={css.taskText}>
                <span className={css.taskTitle}>{task.title}</span>
                <span className={css.taskPrompt}>{task.prompt}</span>
              </span>
              <Menu
                open={menuTask === task.title}
                anchor={(
                  <button
                    type="button"
                    className={css.open}
                    data-state={state ?? 'idle'}
                    disabled={state === 'starting' || state === 'opened'}
                    aria-haspopup="menu"
                    onClick={() => { setMenuTask(current => current === task.title ? null : task.title) }}
                  >
                    <IconPlayOutlineRegular size={12} />
                    {label}
                    <IconChevronDownOutlineRegular size={12} />
                  </button>
                )}
                items={[
                  { id: 'local', label: props.t('row.openLocal') },
                  { id: 'worktree', label: props.t('row.openWorktree') },
                ]}
                onSelect={(id) => {
                  setMenuTask(null)
                  start(task, id === 'worktree' ? 'worktree' : 'local')
                }}
                onClose={() => { setMenuTask(null) }}
              />
              {state === 'failed' ? <span className={css.taskError}>{props.t('row.failed')}</span> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
