/**
 * Right-Sidebar Git Map: the history of the Session's repository drawn as a
 * subway map. The main branch is the line, merges are stations with their
 * branch's commits hanging below, and unmerged branches leave the end of the
 * line as dashed curves. The data comes from one read-only Host lookup per
 * working directory; this body only draws the geometry `model.ts` computes.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconBranchOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorkspaceGitGraph, WorkspaceGitGraphRequest, WorkspaceGitGraphValue,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  layoutGitMap, localDayLabel,
  type GitMapDot, type GitMapDotType, type GitMapLayout, type GitMapStation,
} from './model.ts'
import { useGitGraph } from './use-git-graph.ts'
import css from './GitMapTab.module.css'

/** Business action injected into the Git Map seats. */
export interface GitMapInjected {
  /**
   * Read the git history of a directory.
   * @param request - the Session's working directory and the station limit.
   * @param signal - lifetime of the lookup; abort cancels the Host call.
   * @returns the lookup state and, when ready, the graph; rejects when the Host refuses or the call is lost.
   */
  gitGraph: (request: WorkspaceGitGraphRequest, signal: AbortSignal) => Promise<WorkspaceGitGraphValue>
}

/** Full props of the Git Map tab body. */
export type GitMapTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'workspace'> & InjectFace<GitMapInjected>

type Translate = GitMapTabProps['t']

/** Station counts the selector offers. */
const LIMITS = [18, 40] as const
type Limit = typeof LIMITS[number]

const DOT_CLASS: Record<GitMapDotType, string | undefined> = { feat: css.feat, fix: css.fix, other: css.other }

function Dot({ dot, t }: { readonly dot: GitMapDot; readonly t: Translate }): ReactNode {
  const tip = t('gitMap.tip.commit', { short: dot.commit.short, message: dot.commit.message, author: dot.commit.author })
  return (
    <g>
      <circle cx={dot.x} cy={dot.y} r={dot.r} className={DOT_CLASS[dot.type]} />
      <title>{tip}</title>
      {dot.isHead && <circle cx={dot.x} cy={dot.y} r={dot.r + 4} className={css.headRing} />}
    </g>
  )
}

function Station({ item, t }: { readonly item: GitMapStation; readonly t: Translate }): ReactNode {
  const { station } = item
  const tip = station.commitCount > 0
    ? t('gitMap.tip.mergeCount', { short: station.short, message: station.message, count: station.commitCount })
    : t('gitMap.tip.merge', { short: station.short, message: station.message })
  return (
    <g data-git-station={station.short}>
      {item.curve !== undefined && <path d={item.curve} className={css.curve} />}
      {item.commits.map(dot => <Dot key={dot.key} dot={dot} t={t} />)}
      {item.kind === 'merge' && (
        <g>
          <circle cx={item.x} cy={item.y} r={8} className={css.mergeRing} />
          <title>{tip}</title>
          {item.isHead && <circle cx={item.x} cy={item.y} r={13} className={css.headRing} />}
        </g>
      )}
      {item.dot !== undefined && <Dot dot={item.dot} t={t} />}
      <text x={item.label.x} y={item.label.y} textAnchor="middle" className={css.label}>{item.label.text}</text>
      <text
        x={item.name.x}
        y={item.name.y}
        textAnchor="end"
        className={css.name}
        transform={`rotate(${item.name.rotate} ${item.name.x} ${item.name.y})`}
      >
        {item.name.text}
      </text>
    </g>
  )
}

function MapSvg(
  { layout, graph, t }: { readonly layout: GitMapLayout; readonly graph: WorkspaceGitGraph; readonly t: Translate },
): ReactNode {
  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={t('gitMap.svg.aria', { repo: graph.repoName })}
      className={css.svg}
    >
      <line x1={0} x2={layout.lineEnd} y1={layout.lineY} y2={layout.lineY} className={css.line} />
      <line x1={layout.lineEnd} x2={layout.lineEnd + 18} y1={layout.lineY} y2={layout.lineY} className={css.lineTail} />
      {layout.stations.map(item => <Station key={item.key} item={item} t={t} />)}
      {layout.branches.map(branch => (
        <g key={branch.key} data-git-branch={branch.name}>
          <path d={branch.path} className={css.branchPath} />
          {branch.dots.map(dot => <Dot key={dot.key} dot={dot} t={t} />)}
          <text x={branch.labelX} y={branch.labelY} textAnchor="end" className={css.name}>
            {[
              branch.name,
              branch.extra > 0 ? t('gitMap.branch.extra', { count: branch.extra }) : '',
              branch.isHead ? t('gitMap.branch.here') : '',
            ].filter(part => part !== '').join(' ')}
          </text>
        </g>
      ))}
      {layout.more !== undefined && (
        <text x={layout.more.x} y={layout.more.y} textAnchor="end" className={css.name}>
          {t(layout.more.count === 1 ? 'gitMap.branch.more.one' : 'gitMap.branch.more.other', { count: layout.more.count })}
        </text>
      )}
      {layout.days.map(day => (
        <g key={day.key}>
          <path d={day.path} className={css.bracket} />
          <text x={day.x} y={day.y} textAnchor="middle" className={css.name}>{day.text}</text>
        </g>
      ))}
    </svg>
  )
}

function Legend({ layout, t }: { readonly layout: GitMapLayout; readonly t: Translate }): ReactNode {
  const { counts } = layout
  return (
    <p className={css.legend}>
      <span><i className={`${css.swatch} ${css.feat}`} />{t('gitMap.legend.feat')} {counts.feat}</span>
      <span><i className={`${css.swatch} ${css.fix}`} />{t('gitMap.legend.fix')} {counts.fix}</span>
      <span><i className={`${css.swatch} ${css.other}`} />{t('gitMap.legend.other')} {counts.other}</span>
      <span><i className={`${css.swatch} ${css.swatchMerge}`} />{t('gitMap.legend.merge')} {counts.merge}</span>
      <span><i className={`${css.swatch} ${css.swatchOpen}`} />{t('gitMap.legend.open')}</span>
      <span><i className={`${css.swatch} ${css.swatchHead}`} />{t('gitMap.legend.head')}</span>
    </p>
  )
}

function Ready({ graph, t }: { readonly graph: WorkspaceGitGraph; readonly t: Translate }): ReactNode {
  const layout = useMemo(() => layoutGitMap(graph, { dayLabel: iso => localDayLabel(iso) }), [graph])
  const scroller = useRef<HTMLDivElement>(null)
  // The newest history is at the right: open scrolled to it.
  useEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollLeft = element.scrollWidth
  }, [layout])
  const open = graph.branches.length + graph.moreBranches
  return (
    <>
      <div className={css.summary}>
        <h2 className={css.repo}>{graph.repoName}</h2>
        <p className={css.facts}>
          <span>{t('gitMap.base', { base: graph.base })}</span>
          <span>{t('gitMap.head', { branch: graph.headBranch })}</span>
          <span>{t('gitMap.totals', { total: graph.total, merges: graph.merges })}</span>
          <span>{t('gitMap.shown', { shown: graph.stations.length, open })}</span>
        </p>
      </div>
      <Legend layout={layout} t={t} />
      <div className={css.scroller} ref={scroller}>
        <MapSvg layout={layout} graph={graph} t={t} />
      </div>
      <p className={css.hint}>{t('gitMap.hint')}</p>
    </>
  )
}

/**
 * Render the git history map of the repository the Session works in.
 * @param props - sidebar occurrence, the Session list hook, the Host lookup, and copy.
 * @returns the Git Map panel.
 */
export function GitMapTab({ sessionId, useSessions, gitGraph, t }: GitMapTabProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const running = useSessions(sessions => sessions.byId[sessionId]?.running ?? false)
  const [limit, setLimit] = useState<Limit>(LIMITS[0])
  const [refresh, setRefresh] = useState(0)
  // A flip of the Session's running state repeats the read, so commits the agent just made show up when its turn ends.
  const { outcome, busy } = useGitGraph(cwd, limit, `${running}:${refresh}`, gitGraph)
  const reload = (): void => { setRefresh(count => count + 1) }

  let body: ReactNode
  if (cwd === undefined) body = <p className={css.notice}>{t('gitMap.noSession')}</p>
  else if (outcome === undefined) body = <p className={css.notice}>{t('gitMap.loading')}</p>
  else if (outcome.kind === 'error' || outcome.value.state === 'failed') {
    body = (
      <p className={css.notice} role="alert">
        <span>{t('gitMap.failed')}</span>
        <button type="button" className={css.button} onClick={reload}>{t('gitMap.retry')}</button>
      </p>
    )
  } else if (outcome.value.state === 'no-repository') body = <p className={css.notice}>{t('gitMap.noRepository')}</p>
  else if (outcome.value.state === 'no-commits') body = <p className={css.notice}>{t('gitMap.noCommits')}</p>
  else if (outcome.value.graph === undefined) body = <p className={css.notice}>{t('gitMap.failed')}</p>
  else body = <Ready graph={outcome.value.graph} t={t} />

  return (
    <section className={css.root} data-git-map aria-busy={busy}>
      <div className={css.toolbar}>
        <select
          className={css.select}
          aria-label={t('gitMap.limit.label')}
          value={limit}
          onChange={(event) => { setLimit(Number(event.target.value) === LIMITS[1] ? LIMITS[1] : LIMITS[0]) }}
        >
          {LIMITS.map(count => <option key={count} value={count}>{t('gitMap.limit.option', { count })}</option>)}
        </select>
        <button
          type="button"
          className={css.button}
          title={t('gitMap.refresh')}
          disabled={cwd === undefined}
          onClick={reload}
        >
          <IconRefreshOutlineRegular size={14} />
          <span>{t('gitMap.refresh')}</span>
        </button>
      </div>
      {body}
    </section>
  )
}

/**
 * Render the Git Map tab's chip label.
 * @param props - localized copy.
 * @returns the branch glyph and tab title.
 */
export function GitMapTitle({ t }: PropsRuntime<'sidebar.right.pane.tab.title'> & PropsLocale<'workspace'>): ReactNode {
  return <span className={css.chip}><IconBranchOutlineRegular size={14} /><span>{t('gitMap.title')}</span></span>
}
