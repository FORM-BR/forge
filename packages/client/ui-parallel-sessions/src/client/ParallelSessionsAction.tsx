import { useRef, useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconCompareSplitOutlineRegular,
  IconQuestionOutlineRegular, Menu, Tooltip, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ParallelOfferSource, ParallelStartMode, ParallelTask } from './offer-store.ts'
import css from './ParallelSessionsAction.module.css'

/** What the plugin provides to the header chip. */
export interface ParallelSessionsActionInjected {
  hooks: {
    /** Offers by Session, published by the transcript row that renders the call. */
    parallelOffer: ParallelOfferSource
  }
  /**
   * Create the offered session, send its prompt, and open it in the main region.
   * @param sessionId - the Session whose header carries the chip.
   * @param task - the offered title and prompt.
   * @param mode - run in the offering workspace, or in a new git worktree beside it.
   * @returns completion once the session is created, prompted, and opened.
   */
  startSession: (sessionId: SessionId, task: ParallelTask, mode: ParallelStartMode) => Promise<void>
  /**
   * Hide the whole offer without starting anything.
   * @param sessionId - the Session whose header carries the chip.
   */
  dismiss: (sessionId: SessionId) => void
  /**
   * Drop one started task from the offer, so the chip lists only what is still available.
   * @param sessionId - the Session whose header carries the chip.
   * @param title - the started task's title.
   */
  settle: (sessionId: SessionId, title: string) => void
}

/** Full props of the header chip: owner data, the chip's copy, and the injected offer. */
export type ParallelSessionsActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'parallelSessions'>
  & InjectFace<ParallelSessionsActionInjected>

/** Per-task outcome of the chip's only gesture. */
type StartState = 'starting' | 'opened' | 'failed'

/**
 * Render the offered sessions as a chip in the session header, beside the title: the band already
 * belongs to the window chrome, so a collapsed offer covers no transcript text. Expanding lists the
 * tasks with their start gesture, and the chip renders nothing at all while the Session carries no
 * offer.
 * @param props - slot runtime, locale seat, and the published offer.
 * @returns the header chip plus its collapsible list, or null without an offer.
 */
export function ParallelSessionsAction(props: ParallelSessionsActionProps) {
  const sessionId = props.sessionId
  const offer = props.useParallelOffer(offers => sessionId === undefined ? undefined : offers.get(sessionId))
  const [expanded, setExpanded] = useState(false)
  const [states, setStates] = useState<Record<string, StartState>>({})
  const [menuTask, setMenuTask] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useDismissOnOutsidePointer(rootRef, expanded, setExpanded)
  if (sessionId === undefined || offer === undefined || offer.tasks.length === 0) return null
  const start = (task: ParallelTask, mode: ParallelStartMode): void => {
    setStates(current => ({ ...current, [task.title]: 'starting' }))
    void props.startSession(sessionId, task, mode).then(
      () => {
        setStates(current => ({ ...current, [task.title]: 'opened' }))
        props.settle(sessionId, task.title)
      },
      () => { setStates(current => ({ ...current, [task.title]: 'failed' })) },
    )
  }
  const onKeyDown = (event: { key: string; preventDefault(): void }): void => {
    if (event.key !== 'Escape' || !expanded) return
    event.preventDefault()
    setExpanded(false)
    triggerRef.current?.focus()
  }
  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={expanded}
        aria-label={props.t('chip.aria', { n: offer.tasks.length })}
        onClick={() => { setExpanded(current => !current) }}
      >
        <IconCompareSplitOutlineRegular size={13} />
        <span className={css.count}>{props.t('chip.count', { n: offer.tasks.length })}</span>
        <IconChevronDownOutlineRegular size={11} className={expanded ? css.chevronOpen : undefined} />
      </button>
      {expanded
        ? (
          <section className={css.panel} aria-label={props.t('chip.aria', { n: offer.tasks.length })}>
            <header className={css.panelHeader}>
              <span className={css.panelTitle}>{props.t('chip.count', { n: offer.tasks.length })}</span>
              <button
                type="button"
                className={css.close}
                aria-label={props.t('notice.close')}
                onClick={() => { props.dismiss(sessionId) }}
              >
                <IconCloseOutlineRegular size={12} />
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
                    <span className={css.taskTitle}>{task.title}</span>
                    <Tooltip label={task.prompt} side="bottom" portal maxWidth={320} openOnClick>
                      <button type="button" className={css.details} aria-label={props.t('notice.details')}>
                        <IconQuestionOutlineRegular size={12} />
                      </button>
                    </Tooltip>
                    <Menu
                      open={menuTask === task.title}
                      align="end"
                      portal
                      anchor={(
                        <button
                          type="button"
                          className={css.open}
                          data-state={state ?? 'idle'}
                          disabled={state === 'starting' || state === 'opened'}
                          aria-haspopup="menu"
                          onClick={() => { setMenuTask(current => current === task.title ? null : task.title) }}
                        >
                          {label}
                          <IconChevronDownOutlineRegular size={10} />
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
        : null}
    </div>
  )
}
