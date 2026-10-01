/** Catalog-priced API cost surface for the current Session and ledger history. */
import { useEffect, useState, type ReactNode } from 'react'
import type { CostsDayRow, CostsModelRow } from '@deepseek-ai/dsh-api-costs-controller/types'
// Type-only: pulls the `costUsage` SessionProjectionMap merge into this seat.
import type {} from '@deepseek-ai/dsh-cost-meter/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CostsInjected } from './face.ts'
import type {} from './locales.ts'
import css from './CostsTab.module.css'

/** The shared model-route shape of both the projection and the ledger wire row. */
interface ModelRowLike {
  readonly provider: string
  readonly model: string
  readonly costUsd: number
  readonly attempts: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Standard sidebar owner share plus the injected ledger reads and copy. */
export type CostsTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'sidebarCosts'> & InjectFace<CostsInjected>

/** Compact per-route model rows from both the live projection and the ledger. */
function ModelTable({ rows, t }: { rows: readonly ModelRowLike[]; t: (key: keyof typeof import('./locales.ts').zh) => string }): ReactNode {
  return <Table caption={t('byModel')} head={[
    t('model'), t('inputTokens'), t('outputTokens'), t('attempts'), t('cost'),
  ]} rows={rows.map(row => [
    <span key="m" className={css.modelCell}>
      <span className={css.model}>{row.model}</span>
      <span className={css.provider}>{row.provider}</span>
    </span>,
    formatTokens(row.inputTokens), formatTokens(row.outputTokens), String(row.attempts), formatUsd(row.costUsd),
  ])} />
}

/** Daily ledger buckets, ascending by day. */
function DayTable({ rows, t }: { rows: readonly CostsDayRow[]; t: (key: keyof typeof import('./locales.ts').zh) => string }): ReactNode {
  return <Table caption={t('byDay')} head={[
    t('day'), t('inputTokens'), t('outputTokens'), t('attempts'), t('cost'),
  ]} rows={rows.map(row => [
    <span key="d" className={css.day}>{row.day}</span>,
    formatTokens(row.inputTokens), formatTokens(row.outputTokens), String(row.attempts), formatUsd(row.costUsd),
  ])} />
}

/** One minified table with a heading and right-aligned numeric columns. */
function Table({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly ReactNode[][] }): ReactNode {
  return <figure className={css.tableBox}>
    <figcaption className={css.subheading}>{caption}</figcaption>
    <table className={css.table}>
      <thead><tr>{head.map(cell => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </figure>
}

/**
 * Render the current Session's cost projection and the durable ledger history.
 * @param props - sidebar occurrence, projection hook, ledger reads and copy.
 * @returns the costs panel with both surfaces.
 */
export function CostsTab({ useProjection, byDay, byModel, t }: CostsTabProps): ReactNode {
  const usage = useProjection('costUsage')
  const [history, setHistory] = useState<readonly [readonly CostsDayRow[], readonly CostsModelRow[]]>()
  const [failed, setFailed] = useState<string>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setHistory(undefined)
    setFailed(undefined)
    void Promise.all([byDay(), byModel()]).then(([days, models]) => {
      if (!active) return
      setHistory([days, models])
    }).catch((error: unknown) => {
      if (!active) return
      setFailed(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [byDay, byModel, revision])
  return <section className={css.root} data-sidebar-costs>
    <div className={css.section}>
      <h2 className={css.heading}>{t('session')}</h2>
      {usage === undefined
        ? <p className={css.muted}>{t('empty')}</p>
        : <>
          <p className={css.total}>{formatUsd(usage.totalCostUsd)}</p>
          <dl className={css.stats}>
            <div><dt>{t('attempts')}</dt><dd>{usage.attempts.toLocaleString()}</dd></div>
            {usage.unpricedAttempts > 0 && <div><dt>{t('unpriced')}</dt><dd>{usage.unpricedAttempts.toLocaleString()}</dd></div>}
          </dl>
          {usage.byModel.length > 0 && <ModelTable rows={usage.byModel} t={t} />}
        </>}
    </div>
    <div className={css.section}>
      <h2 className={css.heading}>{t('history')}</h2>
      {failed !== undefined
        ? <p className={css.error} role="alert">{t('failed', { message: failed })} <Button variant="outline" size="sm" onClick={() => { setRevision(value => value + 1) }}>{t('retry')}</Button></p>
        : history === undefined
          ? <p className={css.muted}>{t('loading')}</p>
          : history[0].length === 0 && history[1].length === 0
            ? <p className={css.muted}>{t('empty')}</p>
            : <>
              {history[1].length > 0 && <ModelTable rows={history[1]} t={t} />}
              {history[0].length > 0 && <DayTable rows={history[0]} t={t} />}
            </>}
    </div>
    <p className={css.footnote}>{t('estimate')}</p>
  </section>
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
