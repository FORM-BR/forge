/** Right-Sidebar Agent Map: the delegation tree of the current conversation with live state, activity and cost. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutlineRegular, IconRefreshOutlineRegular, IconWorkspaceTreeOutlineRegular,
  StateDot, Tag, Tooltip, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalogInjected } from '../SubagentHeaderLineage.tsx'
import {
  activityDuration, formatDuration, formatExactDuration, formatTokens, formatUsd,
} from '../metrics.ts'
import { NS } from '../locales.ts'
import {
  buildAgentMap, resolveRootId, unloadedBranches,
  type AgentMapNode, type AgentMapState,
} from './model.ts'
import css from './AgentMapTab.module.css'

/** Business actions injected into the Agent Map seats. */
export interface AgentMapInjected extends SubagentCatalogInjected {
  /** Open the root conversation of the tree. */
  openRoot: (sessionId: SessionId) => void
}

/** Full props of the Agent Map tab body. */
export type AgentMapTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & InjectFace<AgentMapInjected>

type Translate = TranslateNS<typeof NS>

function dotState(state: AgentMapState): StateDotState {
  switch (state) {
    case 'running': return 'ongoing'
    case 'waiting': return 'warning'
    case 'stopped': return 'error'
    case 'completed': return 'done'
    case 'idle': return 'idle'
  }
}

function stateLabel(state: AgentMapState, t: Translate): string {
  switch (state) {
    case 'running': return t('activity.running')
    case 'waiting': return t('map.state.waiting')
    case 'stopped': return t('map.state.stopped')
    case 'completed': return t('activity.completed')
    case 'idle': return t('activity.inactive')
  }
}

function modeLabel(mode: AgentMapNode['mode'], t: Translate): string {
  switch (mode) {
    case 'root': return t('map.root')
    case 'one-shot': return t('mode.oneShot')
    case 'continuable': return t('mode.continuable')
    case 'unknown': return t('mode.unknown')
  }
}

interface RowsProps extends Pick<AgentMapInjected, 'openChild' | 'openChildAside' | 'openRoot' | 'refreshProjection'> {
  readonly nodes: readonly AgentMapNode[]
  readonly level: number
  readonly currentId: SessionId
  readonly collapsed: ReadonlySet<SessionId>
  readonly toggle: (id: SessionId) => void
  readonly now: number
  readonly t: Translate
}

/** Render one tree level and recurse through the nodes that are not collapsed. */
function AgentRows({
  nodes, level, currentId, collapsed, toggle, now, t, openChild, openChildAside, openRoot, refreshProjection,
}: RowsProps): ReactNode {
  return nodes.map((node) => {
    const isCurrent = node.id === currentId
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)
    const running = node.state === 'running' || node.state === 'waiting'
    const durationMs = activityDuration(node.summary, running ? 'running' : 'inactive', now)
    const meta = [modeLabel(node.mode, t), stateLabel(node.state, t)]
    if (durationMs !== undefined) meta.push(formatExactDuration(durationMs, t))
    const address = node.address
    const open = (): void => {
      if (address === undefined) openRoot(node.id)
      else openChild(address)
    }
    const teamLabel = node.team === undefined
      ? undefined
      : node.team.role === 'lead' ? t('map.team.lead') : t('map.team.member', { name: node.team.name })
    return (
      <li
        key={node.id}
        role="treeitem"
        aria-level={level}
        aria-selected={isCurrent}
        {...hasChildren ? { 'aria-expanded': !isCollapsed } : {}}
        className={css.node}
        data-agent-node={node.id}
      >
        <div className={css.row}>
          {hasChildren
            ? (
              <button
                type="button"
                className={`${css.disclosure} ${isCollapsed ? '' : css.disclosureOpen}`}
                aria-label={t(isCollapsed ? 'branch.expand' : 'branch.collapse', { label: node.label })}
                onClick={() => { toggle(node.id) }}
              >
                <IconChevronRightOutlineRegular />
              </button>
            )
            : <span className={css.disclosureSpace} />}
          <span className={css.dotSlot}><StateDot state={dotState(node.state)} /></span>
          <button
            type="button"
            className={css.main}
            aria-label={t('map.open')}
            title={t('map.open')}
            onClick={open}
          >
            <span className={css.titleLine}>
              <span className={`${css.label} ${isCurrent ? css.current : ''}`}>{node.label}</span>
              {isCurrent && <Tag tone="info">{t('map.current')}</Tag>}
              {teamLabel !== undefined && <Tag tone="neutral">{teamLabel}</Tag>}
            </span>
            <span className={css.meta}>{meta.join(' · ')}</span>
            {node.now !== undefined && <span className={`${css.detail} ${css.now}`}>{t('map.now', { text: node.now })}</span>}
            {node.task !== undefined && node.task !== node.label && node.now === undefined && (
              <span className={css.detail}>{node.task}</span>
            )}
            {node.result !== undefined && <span className={css.detail}>{t('map.result', { text: node.result })}</span>}
          </button>
          <span className={css.metrics}>
            <span className={css.cost}>
              {node.costUsd === undefined ? t('map.cost.none') : formatUsd(node.costUsd)}
            </span>
            {hasChildren && node.subtree.costUsd !== undefined && (
              <span title={t('map.cost.subtree.title')}>
                {t('map.cost.subtree', { value: formatUsd(node.subtree.costUsd) })}
              </span>
            )}
            {node.tokens !== undefined && <span>{t('tokens.total', { value: formatTokens(node.tokens, t) })}</span>}
            {durationMs !== undefined && <span>{formatDuration(durationMs, t)}</span>}
          </span>
          {address !== undefined && (
            <Tooltip label={t('open.sidebar')} side="bottom" align="end">
              <button
                type="button"
                className={css.sidebarButton}
                aria-label={t('open.sidebar.aria', { label: node.label })}
                onClick={() => { openChildAside(address) }}
              >
                <IconChevronRightOutlineRegular />
              </button>
            </Tooltip>
          )}
        </div>
        {node.branch === 'error' && (
          <p className={css.branchError} role="alert">
            <span>{node.branchError ?? t('load.error')}</span>
            <button type="button" className={css.refresh} onClick={() => { refreshProjection(node.id) }}>
              <IconRefreshOutlineRegular size={14} />
              {t('retry')}
            </button>
          </p>
        )}
        {node.branch === 'loading' && !hasChildren && <p className={css.notice}>{t('map.loading')}</p>}
        {hasChildren && !isCollapsed && (
          <ul role="group" className={css.group}>
            <AgentRows
              nodes={node.children}
              level={level + 1}
              currentId={currentId}
              collapsed={collapsed}
              toggle={toggle}
              now={now}
              t={t}
              openChild={openChild}
              openChildAside={openChildAside}
              openRoot={openRoot}
              refreshProjection={refreshProjection}
            />
          </ul>
        )}
      </li>
    )
  })
}

/**
 * Render the delegation tree of the conversation that owns this Sidebar.
 * @param props - sidebar occurrence, shared Session store hooks, navigation actions and copy.
 * @returns the Agent Map panel.
 */
export function AgentMapTab({
  sessionId, useSession, useSessions, useSessionStatus,
  openChild, openChildAside, openRoot, refreshProjection, t,
}: AgentMapTabProps): ReactNode {
  const boundParent = useSession(snapshot => snapshot.subagent?.address.parentSessionId)
  const projections = useSessions(state => state.projectionsBySession)
  const summaries = useSessions(state => state.byId)
  const statuses = useSessionStatus(value => value)
  const rootId = useMemo(
    () => resolveRootId(sessionId, boundParent, summaries),
    [sessionId, boundParent, summaries],
  )
  const tree = useMemo(
    () => buildAgentMap({ rootId, projections, summaries, statuses }),
    [rootId, projections, summaries, statuses],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const requested = useRef<Set<SessionId>>(new Set())

  // Grow the tree to its full depth: every agent whose children were never read is asked once.
  useEffect(() => {
    for (const id of unloadedBranches(tree)) {
      if (requested.current.has(id)) continue
      requested.current.add(id)
      refreshProjection(id)
    }
  }, [tree, refreshProjection])

  const active = tree.subtree.active > 0
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [active])

  const toggle = (id: SessionId): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const agentsKey = tree.subtree.agents === 1 ? 'map.agents.one' : 'map.agents.other'
  return (
    <section className={css.root} data-agent-map>
      <div className={css.summary}>
        <h2 className={css.heading}>{t('map.cost.team')}</h2>
        <p className={css.total}>
          {tree.subtree.costUsd === undefined ? t('map.cost.none') : formatUsd(tree.subtree.costUsd)}
        </p>
        <p className={css.facts}>
          <span>{t(agentsKey, { count: tree.subtree.agents })}</span>
          {tree.subtree.active > 0 && <span>{t('map.active', { count: tree.subtree.active })}</span>}
          {tree.subtree.tokens > 0 && <span>{t('tokens.total', { value: formatTokens(tree.subtree.tokens, t) })}</span>}
        </p>
      </div>
      <ul role="tree" aria-label={t('tree.aria')} className={css.tree}>
        <AgentRows
          nodes={[tree]}
          level={1}
          currentId={sessionId}
          collapsed={collapsed}
          toggle={toggle}
          now={now}
          t={t}
          openChild={openChild}
          openChildAside={openChildAside}
          openRoot={openRoot}
          refreshProjection={refreshProjection}
        />
      </ul>
      {tree.children.length === 0 && tree.branch === 'ready' && <p className={css.muted}>{t('map.empty')}</p>}
      <p className={css.footnote}>{t('map.footnote')}</p>
    </section>
  )
}

/**
 * Render the Agent Map tab's chip label.
 * @param props - localized copy.
 * @returns the tree glyph and tab title.
 */
export function AgentMapTitle({ t }: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<typeof NS>): ReactNode {
  return <span className={css.chip}><IconWorkspaceTreeOutlineRegular size={14} /><span>{t('map.title')}</span></span>
}
