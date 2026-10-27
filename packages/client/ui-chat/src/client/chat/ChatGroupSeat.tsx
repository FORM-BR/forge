/** Stable process container; display policy changes visibility, never member parents. */
import { memo, useCallback, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import {
  IconAgentPresetOutlineRegular, IconApiOutlineRegular, IconBrowseOutlineRegular, IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular, IconCodeOutlineRegular, IconEditOutlineRegular, IconGlobeOutlineRegular,
  IconPlanOutlineRegular, IconQuestionOutlineRegular, IconSearchOutlineRegular, IconSparkleRegular,
  IconThinkOutlineRegular, TextShimmer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GroupKey, NodeReference } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ProcessActivity, ProcessStep } from '../contract/process-groups.ts'
import type { ChatStoreState } from '../contract/store.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { storedTurnProcessEntry } from '../stores.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatLiveRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { chatRenderKey } from './render-entry.ts'
import { processTitle } from './step-process.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import { useDisclosure } from './use-disclosure.ts'
import { useProcessScroll } from './use-process-scroll.ts'
import css from './ChatGroupSeat.module.css'

/** Trail rows kept under a collapsed live header; older members stay behind the toggle. */
const TRAIL_LIMIT = 3


type SeatProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey' | 'groupPart'>
type ChatGroupSeatProps = SeatProps & {
  readonly groupKey: GroupKey
  readonly useChatGroup: ChatViewSlotProps['useChatGroup']
}
const PROCESS_TITLE_MINIMUM_MS = 150

type ProcessTitleActivity = ProcessActivity | 'thinking'

interface LiveProcessTitle {
  readonly activity: ProcessTitleActivity
  readonly detail: string
  readonly preparing: boolean
}

const PROCESS_ICONS: Record<ProcessTitleActivity, ReactNode> = {
  thinking: <IconThinkOutlineRegular />,
  read: <IconBrowseOutlineRegular size={14} />,
  readImage: <IconBrowseOutlineRegular size={14} />,
  search: <IconSearchOutlineRegular size={14} />,
  edit: <IconEditOutlineRegular size={14} />,
  write: <IconEditOutlineRegular size={14} />,
  commands: <IconApiOutlineRegular />,
  code: <IconCodeOutlineRegular size={14} />,
  webSearch: <IconGlobeOutlineRegular />,
  webFetch: <IconBrowseOutlineRegular size={14} />,
  subagents: <IconAgentPresetOutlineRegular size={14} />,
  plan: <IconPlanOutlineRegular />,
  questions: <IconQuestionOutlineRegular />,
  tools: <IconSparkleRegular size={14} />,
}

function sameLiveProcessTitle(left: LiveProcessTitle, right: LiveProcessTitle): boolean {
  return left.activity === right.activity && left.detail === right.detail && left.preparing === right.preparing
}

function useStableLiveProcessTitle(desired: LiveProcessTitle, active: boolean): LiveProcessTitle {
  const [displayed, setDisplayed] = useState(desired)
  const displayedRef = useRef(displayed)
  const desiredRef = useRef(desired)
  const displayedAtRef = useRef(Date.now())
  useEffect(() => {
    desiredRef.current = desired
    if (!active || sameLiveProcessTitle(displayedRef.current, desired)) return
    const remaining = PROCESS_TITLE_MINIMUM_MS - (Date.now() - displayedAtRef.current)
    const commit = (): void => {
      const next = desiredRef.current
      displayedRef.current = next
      displayedAtRef.current = Date.now()
      setDisplayed(next)
    }
    if (remaining <= 0) {
      commit()
      return
    }
    const timer = setTimeout(commit, remaining)
    return () => { clearTimeout(timer) }
  }, [active, desired.activity, desired.detail, desired.preparing])
  return active ? displayed : desired
}


const GroupMembers = memo(function GroupMembers({ members, ...props }: SeatProps & {
  readonly members: readonly NodeReference[]
}) {
  return members.map(member => <ChatNodeSeat {...props} key={chatRenderKey(member)} nodeKey={member.key}
    {...member.groupPart === undefined ? {} : { groupPart: member.groupPart }} />)
})

/** Tick the header clock only while this group is live. */
function useLiveNow(startTime: number | undefined, live: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live || startTime === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [live, startTime])
  return now
}

const ProcessTrail = memo(function ProcessTrail({ steps, t }: {
  readonly steps: readonly ProcessStep[]
  readonly t: ChatViewSlotProps['t']
}) {
  return (
    <ol className={css.trail} data-step-process-trail>
      {steps.slice(-TRAIL_LIMIT).map((step, index) => (
        <li key={`${step.kind}-${index}`} className={css.trailRow} data-step-state={step.state}>
          <span className={css.trailIcon} data-step-process-icon>{PROCESS_ICONS[step.kind]}</span>
          <span className={css.trailLabel}>
            {step.detail === '' ? t(`message.stepProcess.${step.kind}`) : step.detail}
          </span>
        </li>
      ))}
    </ol>
  )
})

const ProcessGroupHeader = memo(function ProcessGroupHeader({
  groupKey, useChatGroup, usePresentation, t, open, bodyId, toggle, startTime, trail,
}: {
  readonly groupKey: GroupKey
  readonly useChatGroup: ChatViewSlotProps['useChatGroup']
  readonly usePresentation: ChatViewSlotProps['usePresentation']
  readonly t: ChatViewSlotProps['t']
  readonly open: boolean
  readonly bodyId: string
  readonly toggle: () => void
  readonly startTime: number | undefined
  readonly trail: boolean
}) {
  const data = useChatGroup(groupKey, group => group?.data)
  const detailed = usePresentation(policy => data?.closed === false && policy.liveProcessDetail)
  const live = useStableLiveProcessTitle({
    activity: data?.summary.running ?? 'thinking',
    detail: data?.summary.runningDetail ?? '',
    preparing: data?.summary.preparing === true,
  }, data !== undefined && !data.closed)
  const now = useLiveNow(startTime, data?.closed === false)
  if (data === undefined) return null
  const label = data.closed ? processTitle(data.summary, t)
    : live.preparing ? t(`message.stepProcess.prepare.${live.activity === 'thinking' ? 'tools' : live.activity}`)
      : t(`message.stepProcess.${live.activity}`)
  const detail = detailed && !data.closed ? live.detail : ''
  const title = detail === '' ? label : `${label}${t('message.turnProcess.separator')}${detail}`
  const activity = data.closed ? data.summary.counts[0]?.kind ?? 'thinking' : live.activity
  const steps = data.summary.steps
  const count = data.closed || steps.length === 0 ? ''
    : steps.length === 1 ? t('message.stepProcess.steps.one')
      : t('message.stepProcess.steps.other', { count: steps.length })
  const clock = data.closed || startTime === undefined
    ? '' : formatLiveRunDuration(Math.max(1000, now - startTime), t)
  const meta = count === '' ? ''
    : clock === '' ? count : `${count}${t('message.turnProcess.separator')}${clock}`
  const leading = (
    <span className={css.leading} aria-hidden="true">
      <span className={css.activityIcon} data-step-process-icon>{PROCESS_ICONS[activity]}</span>
      <span className={css.chevron} data-step-process-chevron>
        {open ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
      </span>
    </span>
  )
  const content = (
    <TextShimmer active={!data.closed}>
      <TextShimmer className={css.label}>{title}</TextShimmer>
    </TextShimmer>
  )
  return (
    <div className={css.header}>
      <div className={css.titleRow}>
        <button type="button" className={css.title} aria-expanded={open} aria-controls={bodyId}
          data-process-activity={activity} onClick={(event) => { event.currentTarget.focus(); toggle() }}>
          {leading}
          {content}
        </button>
        {meta !== '' && <span className={css.meta} data-step-process-meta>{meta}</span>}
      </div>
      {trail && !data.closed && steps.length > 0 && <ProcessTrail steps={steps} t={t} />}
    </div>
  )
})


/** Render a process group with local disclosure and the existing outer-Turn visibility. */
export const ChatGroupSeat = memo(function ChatGroupSeat({ groupKey, useChatGroup, ...props }: ChatGroupSeatProps) {
  const members = useChatGroup(groupKey, group => group?.members)
  const turn = useChatGroup(groupKey, group => group?.data.turn)
  const closed = useChatGroup(groupKey, group => group?.data.closed)
  const foldCompleted = props.usePresentation(policy => policy.foldCompletedTurns)
  const { expanded: open, setExpanded: setOpen } = useDisclosure()
  const firstKey = members?.[0]?.key ?? ''
  const presentation = props.useChatNodeProcess(firstKey)
  const turnLocation = props.useChatNode(firstKey, (node) => {
    const location = node?.location
    return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
  })
  const grouped = props.usePresentation(policy => policy.stepGrouping === 'collapsed'
    || (policy.stepGrouping === 'history' && turnLocation?.status !== 'open'))
  const workTrail = props.usePresentation(policy => policy.liveWorkTrail)
  const showHeader = grouped
  const startTime = turnLocation?.start?.time
  const reason = turnLocation?.end?.data.reason.kind
  const alwaysOpen = presentation?.turnClosed === false || presentation?.hasInterleavedInput === true
    || reason === 'aborted' || reason === 'error'
  const spec = presentation?.spec
  const selectStored = useCallback((state: Readonly<ChatStoreState>) => turn === undefined
    ? undefined : storedTurnProcessEntry(state, turn), [turn])
  const stored = props.useStore(selectStored)
  const outerHidden = foldCompleted && presentation?.turnClosed === true && spec !== undefined
    && !alwaysOpen && stored?.answerStep !== (spec.answerStep ?? 0)
  const revealOuter = useCallback(() => {
    if (spec !== undefined && !alwaysOpen) props.actions.setTurnProcessOpen(spec.turn, spec.answerStep ?? 0, true)
  }, [props.actions, spec, alwaysOpen])
  const rootRef = useSearchableHidden(outerHidden, revealOuter)
  useEffect(() => {
    if (outerHidden && rootRef.current?.hasAttribute('hidden')) setOpen(false)
  }, [outerHidden, rootRef, setOpen])
  const reveal = useCallback(() => { setOpen(true) }, [setOpen])
  const bodyRef = useSearchableHidden(grouped && !open, reveal)
  const contentRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()
  const { edges, events, initialize } = useProcessScroll(bodyRef, contentRef, open, grouped)
  const toggle = useCallback(() => {
    if (!open) initialize(closed === false ? 'bottom' : 'top')
    setOpen(!open)
  }, [closed, initialize, open, setOpen])
  if (members === undefined) return null
  const classes = [css.body, !grouped ? css.expandedBody : '',
    grouped && edges.canScrollUp ? css.fadeTop : '', grouped && edges.canScrollDown ? css.fadeBottom : '']
  return (
    <div ref={rootRef} className={css.root} data-chat-group-key={groupKey}
      data-chat-flow-key={groupKey} data-chat-anchor-key={`group:${groupKey}`} data-chat-turn={turn}
      data-chat-paging-anchor={grouped && !open || undefined}
      data-step-process data-group-expanded-mode={!grouped || undefined}>
      <div hidden={!showHeader}>
        <ProcessGroupHeader groupKey={groupKey} useChatGroup={useChatGroup}
          usePresentation={props.usePresentation} t={props.t} open={open} bodyId={bodyId} toggle={toggle}
          startTime={startTime} trail={workTrail && !open && closed === false} />
      </div>
      <div ref={bodyRef} id={bodyId} className={classes.join(' ')} data-step-process-body
        data-scroll-up={edges.canScrollUp || undefined} data-scroll-down={edges.canScrollDown || undefined}
        {...events}>
        <div ref={contentRef} className={css.content} data-step-process-content data-chat-flow="">
          <GroupMembers {...props} members={members} />
        </div>
      </div>
    </div>
  )
})
