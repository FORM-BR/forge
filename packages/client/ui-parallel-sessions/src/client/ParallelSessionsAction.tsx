import { useRef, useState } from 'react'
import {
  IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconCompareSplitOutlineRegular,
  IconQuestionOutlineRegular, Menu, Tooltip, useDismissOnOutsidePointer,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
// Type-only: the shared per-session model directory state (catalog + durable selection).
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ParallelOfferSource, ParallelStartMode, ParallelTask } from './offer-store.ts'
import css from './ParallelSessionsAction.module.css'

/** What the plugin provides to the header chip. */
export interface ParallelSessionsActionInjected {
  hooks: {
    /** Offers by Session, published by the transcript row that renders the call. */
    parallelOffer: ParallelOfferSource
    /** The offering Session's shared model directory: catalog groups plus its durable selection. */
    modelDirectory: ObservableSnapshot<ModelDirectoryState>
  }
  /**
   * Create the offered session, optionally apply a model selection, send its prompt, and open it
   * in the main region.
   * @param sessionId - the Session whose header carries the chip.
   * @param task - the offered title and prompt.
   * @param mode - run in the offering workspace, or in a new git worktree beside it.
   * @param selection - model/effort the new Session runs on; omitted keeps the Host default.
   * @returns completion once the session is created, prompted, and opened.
   */
  startSession: (
    sessionId: SessionId,
    task: ParallelTask,
    mode: ParallelStartMode,
    selection?: ModelSelection,
  ) => Promise<void>
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
  /** Reload the shared model catalog backing the model/effort picker. */
  loadModels: () => void
}

/** Full props of the header chip: owner data, the chip's copy, and the injected offer. */
export type ParallelSessionsActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'parallelSessions'>
  & InjectFace<ParallelSessionsActionInjected>

/** Per-task outcome of the chip's only gesture. */
type StartState = 'starting' | 'opened' | 'failed'

/** Effort row id meaning "the model's provider default"; model rows are `${provider}/${model}`. */
const PROVIDER_DEFAULT_EFFORT = 'effort:default'
const EFFORT_PREFIX = 'effort:'

/**
 * Render the offered sessions as a chip in the session header, beside the title: the band already
 * belongs to the window chrome, so a collapsed offer covers no transcript text. Expanding lists the
 * tasks with their start gesture, a model/effort picker for the next started session, and the chip
 * renders nothing at all while the Session carries no offer.
 * @param props - slot runtime, locale seat, and the published offer.
 * @returns the header chip plus its collapsible list, or null without an offer.
 */
export function ParallelSessionsAction(props: ParallelSessionsActionProps) {
  const sessionId = props.sessionId
  const offer = props.useParallelOffer(offers => offers.get(sessionId))
  const models = props.useModelDirectory(state => state)
  const [expanded, setExpanded] = useState(false)
  const [states, setStates] = useState<Record<string, StartState>>({})
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [menuTask, setMenuTask] = useState<string | null>(null)
  const [pickMenu, setPickMenu] = useState<'model' | 'effort' | null>(null)
  // Explicit model/effort for the next started session; null keeps the Host default.
  const [pick, setPick] = useState<ModelSelection | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // While any menu is open, it (not the panel) owns outside-pointer dismissal: the menu lists
  // are portaled to document.body, so a pointerdown on a menu item is outside the panel root
  // and would otherwise collapse the panel and unmount the menu before onSelect fires.
  useDismissOnOutsidePointer(rootRef, expanded && menuTask === null && pickMenu === null, setExpanded)
  if (offer === undefined || offer.tasks.length === 0) return null

  /** Keep the real failure text beside the generic label, so a refused start is diagnosable. */
  const recordFailure = (title: string, error: unknown): void => {
    setFailures(current => ({
      ...current,
      [title]: error instanceof Error ? error.message : String(error),
    }))
  }

  const start = (task: ParallelTask, mode: ParallelStartMode): void => {
    setStates(current => ({ ...current, [task.title]: 'starting' }))
    // A synchronous throw must settle as 'failed' too: handed to .then directly
    // it would escape the promise chain and leave the task in 'starting' forever.
    let started: Promise<void>
    try {
      started = props.startSession(sessionId, task, mode, pick ?? undefined)
    } catch (error) {
      setStates(current => ({ ...current, [task.title]: 'failed' }))
      recordFailure(task.title, error)
      return
    }
    void started.then(
      () => {
        // The started task is the gesture's whole point: collapse before settle's store write so
        // one commit closes the panel and drops the task, and the panel never re-renders open.
        setStates(current => ({ ...current, [task.title]: 'opened' }))
        setExpanded(false)
        props.settle(sessionId, task.title)
      },
      (error: unknown) => {
        setStates(current => ({ ...current, [task.title]: 'failed' }))
        recordFailure(task.title, error)
      },
    )
  }

  // Picker state: the effective selection is the explicit pick, falling back to the offering
  // Session's durable selection for display; a started session without a pick keeps the default.
  const effective = pick ?? models.current
  const chosenGroup = effective === null ? undefined : models.groups.find(group => group.id === effective.provider)
  const chosenModel = chosenGroup?.models.find(model => model.id === effective?.model)
  const reasoning = chosenModel?.reasoning
  const effectiveEffort = effective?.reasoningEffort ?? reasoning?.defaultEffort
  const modelLabel = effective === null
    ? props.t('pick.modelDefault')
    : chosenModel?.name ?? `${effective.provider}/${effective.model}`
  const effortLabel = reasoning === undefined
    ? undefined
    : reasoning.efforts.find(level => level.id === effectiveEffort)?.name
      ?? (reasoning.defaultEffort === undefined ? props.t('pick.effortDefault') : reasoning.defaultEffort)
  const modelItems: readonly MenuEntry[] = models.groups.flatMap(group => [
    { type: 'label' as const, id: `provider:${group.id}`, text: group.name },
    ...group.models.map(model => ({ id: `${group.id}/${model.id}`, label: model.name })),
  ])
  const effortItems: readonly MenuEntry[] = reasoning === undefined
    ? []
    : [
      ...(reasoning.defaultEffort === undefined
        ? [{ id: PROVIDER_DEFAULT_EFFORT, label: props.t('pick.effortDefault') }]
        : []),
      ...reasoning.efforts.map(level => ({ id: `${EFFORT_PREFIX}${level.id}`, label: level.name })),
    ]

  /** Resolve a model row back to its selection by lookup against the loaded groups. */
  const chooseModel = (id: string): void => {
    for (const group of models.groups) {
      const model = group.models.find(candidate => `${group.id}/${candidate.id}` === id)
      if (model === undefined) continue
      // No explicit effort: the Host fills the model's own default effort.
      setPick({ provider: group.id, model: model.id })
      return
    }
  }

  const chooseEffort = (id: string): void => {
    if (effective === null) return
    const effort = id === PROVIDER_DEFAULT_EFFORT ? undefined : id.slice(EFFORT_PREFIX.length)
    setPick({
      provider: effective.provider,
      model: effective.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
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
        onClick={() => {
          if (!expanded) props.loadModels()
          setExpanded(current => !current)
        }}
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
            {models.groups.length > 0
              ? (
                <div className={css.pick}>
                  <Menu
                    open={pickMenu === 'model'}
                    align="start"
                    portal
                    anchor={(
                      <button
                        type="button"
                        className={css.pickButton}
                        aria-haspopup="menu"
                        aria-expanded={pickMenu === 'model'}
                        onClick={() => { setPickMenu(current => current === 'model' ? null : 'model') }}
                      >
                        <span className={css.pickLabel}>{props.t('pick.model')}</span>
                        <span className={css.pickValue}>{modelLabel}</span>
                        <IconChevronDownOutlineRegular size={10} />
                      </button>
                    )}
                    items={modelItems}
                    selectedId={effective === null ? undefined : `${effective.provider}/${effective.model}`}
                    onSelect={chooseModel}
                    onClose={() => { setPickMenu(null) }}
                  />
                  {reasoning !== undefined
                    ? (
                      <Menu
                        open={pickMenu === 'effort'}
                        align="start"
                        portal
                        anchor={(
                          <button
                            type="button"
                            className={css.pickButton}
                            aria-haspopup="menu"
                            aria-expanded={pickMenu === 'effort'}
                            onClick={() => { setPickMenu(current => current === 'effort' ? null : 'effort') }}
                          >
                            <span className={css.pickLabel}>{props.t('pick.effort')}</span>
                            <span className={css.pickValue}>{effortLabel}</span>
                            <IconChevronDownOutlineRegular size={10} />
                          </button>
                        )}
                        items={effortItems}
                        selectedId={effectiveEffort === undefined ? PROVIDER_DEFAULT_EFFORT : `${EFFORT_PREFIX}${effectiveEffort}`}
                        onSelect={chooseEffort}
                        onClose={() => { setPickMenu(null) }}
                      />
                    )
                    : null}
                </div>
              )
              : null}
            <ul className={css.tasks}>
              {offer.tasks.map((task) => {
                const state = states[task.title]
                const label = state === 'starting'
                  ? props.t('row.opening')
                  : state === 'opened' ? props.t('row.opened') : props.t('row.open')
                const failure = failures[task.title]
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
                    {state === 'failed'
                      ? (
                        <span className={css.taskError}>
                          <span>{props.t('row.failed')}</span>
                          {failure === undefined || failure === ''
                            ? null
                            : <span className={css.taskErrorDetail}>{failure}</span>}
                        </span>
                      )
                      : null}
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
