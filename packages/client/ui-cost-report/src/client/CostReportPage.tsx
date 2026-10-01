/**
 * Global cost report: the cross-session ledger broken down by day, with
 * date, workspace, and model filters, summary cards, a daily cost series, and
 * a session drill-down. The Host projects the SQLite ledger over Remote, so
 * the page only reads; retries re-run the same reads.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CostReportFilter, CostReportRow } from '@deepseek-ai/dsh-api-cost-report/types'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createCostReportStore } from './cost-report-store.ts'
import type { CostReportInjected } from './face.ts'
import type { CostReportLocaleKey } from './locales.ts'
import type {} from './locales.ts'
import css from './CostReportPage.module.css'

type Status =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly days: readonly CostReportRow[]; readonly sessions: readonly CostReportRow[] }
  | { readonly kind: 'failed'; readonly message: string }

type Options =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly workspaces: readonly string[]; readonly models: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string }

/** Component-internal translate signature passed to presentational helpers. */
type Translate = (key: CostReportLocaleKey) => string

/** Full component props assembled by the main slot renderer. */
export type CostReportPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'costReport'>
  & InjectFace<CostReportInjected>
  & PropsStore<ReturnType<typeof createCostReportStore>>

/**
 * Render the cost report panel: filters, summary cards, the daily series,
 * and the session drill-down, each with its own loading and failure state.
 * @param props - the panel's store, injected ledger reads, and localized copy.
 * @returns the report panel.
 */
export function CostReportPage({ useStore, actions, report, workspaces, models, t }: CostReportPageProps): ReactNode {
  const filters = useStore(state => state)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [options, setOptions] = useState<Options>({ kind: 'loading' })
  const [revision, setRevision] = useState(0)
  // The filter catalogs change with the ledger; retry along with the report reads.
  useEffect(() => {
    let active = true
    setOptions({ kind: 'loading' })
    void Promise.all([workspaces(), models()]).then(([workspaceNames, modelRows]) => {
      if (!active) return
      setOptions({ kind: 'ready', workspaces: workspaceNames, models: modelRows.map(row => row.model) })
    }).catch((error: unknown) => {
      if (!active) return
      setOptions({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [workspaces, models, revision])
  useEffect(() => {
    let active = true
    setStatus({ kind: 'loading' })
    const filter: CostReportFilter = {
      ...(filters.fromDay !== '' ? { fromDay: filters.fromDay } : {}),
      ...(filters.toDay !== '' ? { toDay: filters.toDay } : {}),
      ...(filters.cwd !== null ? { cwd: filters.cwd } : {}),
      ...(filters.model !== null ? { model: filters.model } : {}),
    }
    void Promise.all([report('day', filter), report('session', filter)]).then(([days, sessions]) => {
      if (!active) return
      setStatus({ kind: 'ready', days, sessions })
    }).catch((error: unknown) => {
      if (!active) return
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [report, filters, revision])
  const retry = (): void => { setRevision(value => value + 1) }
  return <section className={css.root} data-cost-report>
    <header className={css.header}>
      <h1 className={css.heading}>{t('panel')}</h1>
      <p className={css.footnote}>{t('estimate')}</p>
    </header>
    <div className={css.filters}>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('from')}</span>
        <Input type="date" value={filters.fromDay} aria-label={t('from')}
          onChange={event => { actions.setRange(event.target.value, filters.toDay) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('to')}</span>
        <Input type="date" value={filters.toDay} aria-label={t('to')}
          onChange={event => { actions.setRange(filters.fromDay, event.target.value) }} />
      </label>
    </div>
    {options.kind === 'failed' && <p className={css.error} role="alert">
      {t('failed', { message: options.message })} <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>
    </p>}
    {options.kind === 'ready' && <>
      <FilterRow label={t('workspace')} t={t} values={options.workspaces} active={filters.cwd}
        onSelect={value => { actions.setCwd(value) }} />
      <FilterRow label={t('model')} t={t} values={options.models} active={filters.model}
        onSelect={value => { actions.setModel(value) }} />
    </>}
    {status.kind === 'loading' && <p className={css.muted}>{t('loading')}</p>}
    {status.kind === 'failed' && <p className={css.error} role="alert">
      {t('failed', { message: status.message })} <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>
    </p>}
    {status.kind === 'ready' && (status.days.length === 0 && status.sessions.length === 0
      ? <p className={css.muted}>{t('empty')}</p>
      : <>
        <Cards days={status.days} t={t} />
        {status.days.length > 0 && <DailySeries days={status.days} t={t} />}
        {status.sessions.length > 0 && <SessionTable sessions={status.sessions} t={t} />}
      </>)}
  </section>
}

/** One filter dimension as an "all" plus one selectable capsule per value. */
function FilterRow({ t, label, values, active, onSelect }: {
  t: Translate
  label: string
  values: readonly string[]
  active: string | null
  onSelect: (value: string | null) => void
}): ReactNode {
  return <div className={css.filterRow}>
    <span className={css.fieldLabel}>{label}</span>
    <Pill active={active === null} onClick={() => onSelect(null)}>{t('all')}</Pill>
    {values.map(value => (
      <Pill key={value} active={active === value} onClick={() => onSelect(value)}>{value}</Pill>
    ))}
  </div>
}

/** Total-cost and volume summary over the filtered day rows. */
function Cards({ days, t }: { days: readonly CostReportRow[]; t: Translate }): ReactNode {
  const total = days.reduce((sum, row) => sum + row.costUsd, 0)
  const attempts = days.reduce((sum, row) => sum + row.attempts, 0)
  const inputTokens = days.reduce((sum, row) => sum + row.inputTokens, 0)
  const outputTokens = days.reduce((sum, row) => sum + row.outputTokens, 0)
  return <dl className={css.cards}>
    <div className={css.card}><dt>{t('total')}</dt><dd>{formatUsd(total)}</dd></div>
    <div className={css.card}><dt>{t('attempts')}</dt><dd>{attempts.toLocaleString()}</dd></div>
    <div className={css.card}><dt>{t('inputTokens')}</dt><dd>{formatTokens(inputTokens)}</dd></div>
    <div className={css.card}><dt>{t('outputTokens')}</dt><dd>{formatTokens(outputTokens)}</dd></div>
  </dl>
}

/** Daily cost as a proportional bar series; each bar's title carries the exact value. */
function DailySeries({ days, t }: { days: readonly CostReportRow[]; t: Translate }): ReactNode {
  const peak = Math.max(...days.map(row => row.costUsd), 0)
  const height = 88
  const width = Math.max(days.length * 24, 120)
  return <figure className={css.seriesBox}>
    <figcaption className={css.subheading}>{t('dailyCost')}</figcaption>
    <div className={css.scroll}>
      <svg className={css.series} viewBox={`0 0 ${width} ${height + 14}`} role="img" aria-label={t('dailyCost')}>
        {days.map((row, index) => {
          const barHeight = peak === 0 ? 0 : Math.max(2, Math.round((row.costUsd / peak) * (height - 4)))
          const x = index * 24
          return <g key={row.day ?? index}>
            <rect x={x + 5} y={height - barHeight} width={14} height={barHeight} rx={2}>
              <title>{`${row.day ?? ''}: ${formatUsd(row.costUsd)}`}</title>
            </rect>
            <text x={x + 12} y={height + 12} className={css.tickLabel} textAnchor="middle">
              {(row.day ?? '').slice(5)}
            </text>
          </g>
        })}
      </svg>
    </div>
  </figure>
}

/** Session drill-down rows, most expensive first as the Host reports them. */
function SessionTable({ sessions, t }: { sessions: readonly CostReportRow[]; t: Translate }): ReactNode {
  return <figure className={css.tableBox}>
    <figcaption className={css.subheading}>{t('sessions')}</figcaption>
    <table className={css.table}>
      <thead><tr>
        <th scope="col">{t('session')}</th>
        <th scope="col">{t('day')}</th>
        <th scope="col">{t('model')}</th>
        <th scope="col">{t('attempts')}</th>
        <th scope="col">{t('cost')}</th>
      </tr></thead>
      <tbody>{sessions.map((row, index) => (
        <tr key={row.sessionId ?? index}>
          <td className={css.sessionId}>{shortSession(row.sessionId)}</td>
          <td className={css.day}>{row.day}</td>
          <td>
            <span className={css.modelCell}>
              <span className={css.model}>{row.model}</span>
              <span className={css.provider}>{row.provider}</span>
            </span>
          </td>
          <td>{row.attempts.toLocaleString()}</td>
          <td>{formatUsd(row.costUsd)}</td>
        </tr>
      ))}</tbody>
    </table>
  </figure>
}

/** Session ids are long; keep the head and tail of anything past twelve chars. */
function shortSession(sessionId?: string): string {
  if (sessionId === undefined) return '—'
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}

/** USD with enough decimals to keep sub-cent catalog costs readable. */
function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value >= 0.1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(Math.min(8, Math.floor(-Math.log10(value)) + 2))}`
}

/** Compact token counts (12.3k, 1.2M). */
function formatTokens(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}