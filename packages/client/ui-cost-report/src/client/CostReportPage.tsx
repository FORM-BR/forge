/**
 * Global cost report: the cross-session ledger broken down by day, with
 * date, workspace, and model filters, summary cards, a daily cost series,
 * model and workspace breakdowns, and a session drill-down. The Host projects
 * the SQLite ledger over Remote, so the page only reads; retries re-run the
 * same reads.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CostReportFilter, CostReportRow, UsdBrlRate } from '@deepseek-ai/dsh-api-cost-report/types'
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: adds the `useSessions` runtime prop to GlobalStandardProps.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { CostReportCurrency, createCostReportStore } from './cost-report-store.ts'
import type { CostReportInjected } from './face.ts'
import type {} from './locales.ts'
import css from './CostReportPage.module.css'

/** The four ledger groupings one report read returns. */
type Buckets = {
  readonly days: readonly CostReportRow[]
  readonly sessions: readonly CostReportRow[]
  readonly models: readonly CostReportRow[]
  readonly cwds: readonly CostReportRow[]
}

type Status =
  | { readonly kind: 'loading' }
  | ({ readonly kind: 'ready' } & Buckets)
  | { readonly kind: 'failed'; readonly message: string }

/** Daily exchange rates for the BRL view, keyed by the day range they cover. */
type Rates =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'ready'; readonly key: string; readonly rows: readonly UsdBrlRate[] }
  | { readonly kind: 'failed'; readonly key: string }

/** Formats one amount in the panel's display currency. */
type Money = (value: number) => string

type Options =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly workspaces: readonly string[]; readonly models: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string }

/** Full component props assembled by the main slot renderer. */
export type CostReportPageProps =
  PropsRuntime<'main'>
  & PropsLocale<'costReport'>
  & InjectFace<CostReportInjected>
  & PropsStore<ReturnType<typeof createCostReportStore>>

/** Component-internal translate signature passed to presentational helpers. */
type Translate = CostReportPageProps['t']

/** Session id to its durable title from the client session list, when known. */
type TitleLookup = (sessionId: string | undefined) => string | undefined

/** Quick range presets; each resolves to an inclusive day range ending today. */
const PRESETS = ['last7', 'last30', 'thisMonth', 'allTime'] as const
type Preset = typeof PRESETS[number]

/** Longest day span the daily series gap-fills; wider spans keep only data days. */
const MAX_FILLED_DAYS = 366

/** Session rows shown before the "show all" toggle. */
const SESSION_PREVIEW = 10

/** Display currencies offered by the toggle. */
const CURRENCIES: readonly CostReportCurrency[] = ['USD', 'BRL']

/**
 * Render the cost report panel: filters, summary cards, the daily series,
 * the model and workspace breakdowns, and the session drill-down, each with
 * its own loading and failure state.
 * @param props - the panel's store, injected ledger reads, and localized copy.
 * @returns the report panel.
 */
export function CostReportPage({
  useStore, actions, report, workspaces, models, usdBrlRates, useSessions, t,
}: CostReportPageProps): ReactNode {
  const filters = useStore(state => state)
  const sessionRows = useSessions(state => state.byId)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [options, setOptions] = useState<Options>({ kind: 'loading' })
  const [revision, setRevision] = useState(0)
  const [rates, setRates] = useState<Rates>({ kind: 'idle' })
  const { fromDay, toDay, cwd, model, currency } = filters
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
      ...(fromDay !== '' ? { fromDay } : {}),
      ...(toDay !== '' ? { toDay } : {}),
      ...(cwd !== null ? { cwd } : {}),
      ...(model !== null ? { model } : {}),
    }
    void Promise.all([
      report('day', filter), report('session', filter), report('model', filter), report('cwd', filter),
    ]).then(([days, sessions, modelRows, cwdRows]) => {
      if (!active) return
      setStatus({ kind: 'ready', days, sessions, models: modelRows, cwds: cwdRows })
    }).catch((error: unknown) => {
      if (!active) return
      setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [report, fromDay, toDay, cwd, model, revision])
  // The BRL view needs one rate per visible day; read them only while it is shown.
  const rateRange = status.kind === 'ready' && currency === 'BRL' ? dayRange(status.days) : undefined
  const rateKey = rateRange === undefined ? '' : `${rateRange[0]}|${rateRange[1]}|${revision}`
  useEffect(() => {
    if (rateKey === '') return
    const [first = '', last = ''] = rateKey.split('|')
    let active = true
    setRates({ kind: 'loading', key: rateKey })
    void usdBrlRates(first, last).then((rows) => {
      if (active) setRates({ kind: 'ready', key: rateKey, rows })
    }).catch(() => {
      if (active) setRates({ kind: 'failed', key: rateKey })
    })
    return () => { active = false }
  }, [usdBrlRates, rateKey])
  const retry = (): void => { setRevision(value => value + 1) }
  const rateRows = rates.kind === 'ready' && rates.key === rateKey && rates.rows.length > 0 ? rates.rows : undefined
  const shown: CostReportCurrency = currency === 'BRL' && rateRows !== undefined ? 'BRL' : 'USD'
  const money: Money = value => formatMoney(value, shown)
  const buckets = status.kind !== 'ready'
    ? undefined
    : rateRows === undefined || shown !== 'BRL' ? status : convertBuckets(status, rateRows)
  const ratesPending = rates.kind === 'loading' || (rates.kind !== 'idle' && rates.key !== rateKey)
  const titleOf: TitleLookup = sessionId => (sessionId === undefined
    ? undefined
    : (sessionRows as Partial<Record<string, { readonly title?: string }>>)[sessionId]?.title)
  const preset = activePreset(filters.fromDay, filters.toDay)
  return <section className={css.root} data-cost-report>
    <header className={css.header}>
      <div className={css.titleRow}>
        <h1 className={css.heading}>{t('panel')}</h1>
        <div className={css.presets} role="group" aria-label={t('currency')}>
          {CURRENCIES.map(code => (
            <Pill key={code} active={currency === code} onClick={() => { actions.setCurrency(code) }}>{code}</Pill>
          ))}
        </div>
      </div>
      <p className={css.footnote}>{status.kind === 'ready' ? sourceNote(status.days, t) : t('estimate')}</p>
      {currency === 'BRL' && status.kind === 'ready' && status.days.length > 0 && <p className={css.footnote} data-fx-note>
        {ratesPending ? t('fxLoading') : shown === 'BRL' ? t('fxNote') : t('fxUnavailable')}
      </p>}
    </header>
    <div className={css.toolbar}>
      <div className={css.presets} role="group" aria-label={t('range')}>
        {PRESETS.map(name => (
          <Pill key={name} active={preset === name} onClick={() => {
            const [from, to] = presetRange(name)
            actions.setRange(from, to)
          }}>{t(name)}</Pill>
        ))}
      </div>
      <div className={css.filters}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('from')}</span>
          <Input type="date" value={filters.fromDay} aria-label={t('from')}
            onChange={(event) => { actions.setRange(event.target.value, filters.toDay) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('to')}</span>
          <Input type="date" value={filters.toDay} aria-label={t('to')}
            onChange={(event) => { actions.setRange(filters.fromDay, event.target.value) }} />
        </label>
      </div>
    </div>
    {options.kind === 'failed' && <p className={css.error} role="alert">
      {t('failed', { message: options.message })} <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>
    </p>}
    {options.kind === 'ready' && <div className={css.filterGroup}>
      <FilterRow label={t('workspace')} t={t} values={options.workspaces} active={filters.cwd}
        display={baseName} onSelect={(value) => { actions.setCwd(value) }} />
      <FilterRow label={t('model')} t={t} values={options.models} active={filters.model}
        display={value => value} onSelect={(value) => { actions.setModel(value) }} />
    </div>}
    {status.kind === 'loading' && <p className={css.muted}>{t('loading')}</p>}
    {status.kind === 'failed' && <p className={css.error} role="alert">
      {t('failed', { message: status.message })} <Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>
    </p>}
    {buckets !== undefined && (buckets.days.length === 0 && buckets.sessions.length === 0
      ? <p className={css.muted}>{t('empty')}</p>
      : <>
        <Cards days={buckets.days} money={money} t={t} />
        {buckets.days.length > 0 && <DailySeries days={buckets.days} fromDay={fromDay} toDay={toDay}
          money={money} currency={shown} t={t} />}
        {(buckets.models.length > 0 || buckets.cwds.length > 0) && <div className={css.breakdowns}>
          {buckets.models.length > 0 && <Breakdown title={t('byModel')} t={t} money={money} rows={buckets.models}
            keyOf={row => row.model ?? ''} label={row => row.model ?? '—'} hint={row => row.provider}
            active={filters.model} onSelect={(value) => { actions.setModel(value) }} />}
          {buckets.cwds.length > 0 && <Breakdown title={t('byWorkspace')} t={t} money={money} rows={buckets.cwds}
            keyOf={row => row.cwd ?? ''} label={row => baseName(row.cwd ?? '—')} hint={row => row.cwd}
            active={filters.cwd} onSelect={(value) => { actions.setCwd(value) }} />}
        </div>}
        {buckets.sessions.length > 0 && <SessionTable sessions={buckets.sessions} titleOf={titleOf} money={money} t={t} />}
      </>)}
  </section>
}

/** One filter dimension as an "all" plus one selectable capsule per value. */
function FilterRow({ t, label, values, active, display, onSelect }: {
  t: Translate
  label: string
  values: readonly string[]
  active: string | null
  display: (value: string) => string
  onSelect: (value: string | null) => void
}): ReactNode {
  return <div className={css.filterRow}>
    <span className={css.filterLabel}>{label}</span>
    <Pill active={active === null} onClick={() => onSelect(null)}>{t('all')}</Pill>
    {values.map(value => (
      <Pill key={value} active={active === value} title={value} aria-label={value}
        onClick={() => onSelect(value)}>{display(value)}</Pill>
    ))}
  </div>
}

/**
 * Total-cost and volume summary over the filtered day rows. Prompt tokens
 * count uncached input plus cache reads, the way providers bill them.
 */
function Cards({ days, money, t }: { days: readonly CostReportRow[]; money: Money; t: Translate }): ReactNode {
  const total = days.reduce((sum, row) => sum + row.costUsd, 0)
  const attempts = days.reduce((sum, row) => sum + row.attempts, 0)
  const cacheRead = days.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0)
  const promptTokens = days.reduce((sum, row) => sum + row.inputTokens, 0) + cacheRead
  const outputTokens = days.reduce((sum, row) => sum + row.outputTokens, 0)
  const activeDays = days.filter(row => row.costUsd > 0).length
  const tokens = promptTokens + outputTokens
  return <dl className={css.cards}>
    <div className={`${css.card} ${css.cardPrimary}`}>
      <dt>{t('total')}</dt><dd>{money(total)}</dd>
      {activeDays > 0 && <span className={css.cardHint}>
        {t('avgPerDay', { value: money(total / activeDays), days: activeDays })}
      </span>}
    </div>
    <div className={css.card}>
      <dt>{t('attempts')}</dt><dd>{attempts.toLocaleString()}</dd>
      {attempts > 0 && <span className={css.cardHint}>{t('perAttempt', { value: money(total / attempts) })}</span>}
    </div>
    <div className={css.card}>
      <dt>{t('inputTokens')}</dt><dd>{formatTokens(promptTokens)}</dd>
      {promptTokens > 0 && <span className={css.cardHint}>{t('cacheHitRate', { value: formatShare(cacheRead / promptTokens) })}</span>}
    </div>
    <div className={css.card}>
      <dt>{t('outputTokens')}</dt><dd>{formatTokens(outputTokens)}</dd>
      {tokens > 0 && <span className={css.cardHint}>{t('perMillion', { value: money((total / tokens) * 1e6) })}</span>}
    </div>
  </dl>
}

/**
 * Daily cost as a responsive bar series over a gap-filled day axis, so idle
 * days read as gaps instead of disappearing. Each bar carries its exact value
 * in a hover label and in its accessible name.
 */
function DailySeries({ days, fromDay, toDay, money, currency, t }: {
  days: readonly CostReportRow[]
  fromDay: string
  toDay: string
  money: Money
  currency: CostReportCurrency
  t: Translate
}): ReactNode {
  const series = fillDays(days, fromDay, toDay)
  const peak = Math.max(...series.map(row => row.costUsd), 0)
  const scale = niceCeil(peak)
  const step = Math.max(1, Math.ceil(series.length / 12))
  return <figure className={css.panel}>
    <div className={css.panelHead}>
      <figcaption className={css.subheading}>{t('dailyCost')}</figcaption>
      {peak > 0 && <span className={css.panelMeta}>{t('peak', { value: money(peak) })}</span>}
    </div>
    <div className={css.chart} role="img" aria-label={t('dailyCost')}>
      <div className={css.yAxis} aria-hidden>
        {[scale, scale / 2, 0].map(value => <span key={value}>{formatAxis(value, currency)}</span>)}
      </div>
      <div className={css.plot}>
        <div className={css.grid} aria-hidden><span /><span /><span /></div>
        <div className={css.bars}>
          {series.map((row, index) => {
            const share = scale === 0 ? 0 : row.costUsd / scale
            return <div key={row.day} className={css.slot} aria-label={`${formatDay(row.day)}: ${money(row.costUsd)}`}>
              <div className={css.barArea}>
                {row.costUsd > 0 && <span className={css.tip}>
                  <strong>{money(row.costUsd)}</strong>
                  <span>{formatDay(row.day)} · {t('attemptsCount', { count: row.attempts.toLocaleString() })}</span>
                </span>}
                <div className={css.bar} data-bar data-value={row.costUsd}
                  style={{ height: `${(share * 100).toFixed(2)}%` }} />
              </div>
              <span className={css.xLabel} aria-hidden>
                {index % step === 0 || index === series.length - 1 ? formatDay(row.day) : ''}
              </span>
            </div>
          })}
        </div>
      </div>
    </div>
  </figure>
}

/**
 * One ranked cost breakdown: each row shows its share of the filtered total
 * as a bar and toggles the matching filter when clicked.
 */
function Breakdown({ title, t, money, rows, keyOf, label, hint, active, onSelect }: {
  title: string
  t: Translate
  money: Money
  rows: readonly CostReportRow[]
  keyOf: (row: CostReportRow) => string
  label: (row: CostReportRow) => string
  hint: (row: CostReportRow) => string | undefined
  active: string | null
  onSelect: (value: string | null) => void
}): ReactNode {
  const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd)
  const total = sorted.reduce((sum, row) => sum + row.costUsd, 0)
  const top = sorted[0]?.costUsd ?? 0
  return <figure className={css.panel}>
    <div className={css.panelHead}>
      <figcaption className={css.subheading}>{title}</figcaption>
    </div>
    <ul className={css.rank}>
      {sorted.map((row) => {
        const key = keyOf(row)
        const selected = active === key
        const detail = hint(row)
        return <li key={key}>
          <button type="button" className={css.rankRow} data-selected={selected || undefined}
            title={detail ?? label(row)} onClick={() => onSelect(selected ? null : key)}>
            <span className={css.rankName}>
              <span className={css.rankLabel}>{label(row)}</span>
              {detail !== undefined && detail !== label(row) && <span className={css.rankHint}>{detail}</span>}
            </span>
            <span className={css.rankValue}>
              {money(row.costUsd)}
              <span className={css.rankShare}>{total === 0 ? '' : formatShare(row.costUsd / total)}</span>
            </span>
            <span className={css.track} aria-hidden>
              <span className={css.fill} style={{ width: `${top === 0 ? 0 : (row.costUsd / top) * 100}%` }} />
            </span>
          </button>
        </li>
      })}
    </ul>
    {sorted.length > 1 && <p className={css.panelFoot}>{t('clickToFilter')}</p>}
  </figure>
}

/** Session drill-down rows, most expensive first as the Host reports them. */
function SessionTable({ sessions, titleOf, money, t }: {
  sessions: readonly CostReportRow[]
  titleOf: TitleLookup
  money: Money
  t: Translate
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? sessions : sessions.slice(0, SESSION_PREVIEW)
  return <figure className={css.panel}>
    <div className={css.panelHead}>
      <figcaption className={css.subheading}>{t('sessions')}</figcaption>
      <span className={css.panelMeta}>{sessions.length.toLocaleString()}</span>
    </div>
    <div className={css.tableScroll}>
      <table className={css.table}>
        <thead><tr>
          <th scope="col">{t('session')}</th>
          <th scope="col">{t('day')}</th>
          <th scope="col">{t('model')}</th>
          <th scope="col" className={css.num}>{t('tokens')}</th>
          <th scope="col" className={css.num}>{t('attempts')}</th>
          <th scope="col" className={css.num}>{t('cost')}</th>
        </tr></thead>
        <tbody>{visible.map((row, index) => {
          const title = titleOf(row.sessionId)
          return <tr key={row.sessionId ?? index}>
            <td>
              <span className={css.sessionCell}>
                {title !== undefined && <span className={css.sessionTitle} title={title}>{title}</span>}
                <span className={css.sessionMeta}>
                  <span className={css.sessionId} title={row.sessionId}>{shortSession(row.sessionId)}</span>
                  {row.cwd !== undefined && <span title={row.cwd}>{baseName(row.cwd)}</span>}
                </span>
              </span>
            </td>
            <td className={css.day}>{row.day}</td>
            <td>
              {row.model === undefined
                ? <span className={css.provider}>{t('mixedModels')}</span>
                : <span className={css.modelCell}>
                  <span className={css.model}>{row.model}</span>
                  <span className={css.provider}>{row.provider}</span>
                </span>}
            </td>
            <td className={css.num}>
              <span className={css.tokenPair}
                title={t('tokensTitle', {
                  input: (row.inputTokens + (row.cacheReadTokens ?? 0)).toLocaleString(),
                  output: row.outputTokens.toLocaleString(),
                })}>
                {formatTokens(row.inputTokens + (row.cacheReadTokens ?? 0))}
                <span className={css.provider}> / {formatTokens(row.outputTokens)}</span>
              </span>
            </td>
            <td className={css.num}>{row.attempts.toLocaleString()}</td>
            <td className={`${css.num} ${css.cost}`}>{money(row.costUsd)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {sessions.length > SESSION_PREVIEW && <div className={css.panelFoot}>
      <Button variant="outline" size="sm" onClick={() => { setExpanded(value => !value) }}>
        {expanded ? t('showLess') : t('showAll', { count: sessions.length })}
      </Button>
    </div>}
  </figure>
}

/**
 * Expand the day rows into a continuous day axis spanning the first and last
 * data day, widened to the filter bounds (an open upper bound means today)
 * but never past today. Spans past
 * {@link MAX_FILLED_DAYS} keep only the data rows.
 */
function fillDays(days: readonly CostReportRow[], fromDay: string, toDay: string): CostReportRow[] {
  const sorted = days
    .filter((row): row is CostReportRow & { day: string } => row.day !== undefined)
    .sort((a, b) => a.day.localeCompare(b.day))
  const firstData = sorted[0]?.day
  const lastData = sorted.at(-1)?.day
  if (firstData === undefined || lastData === undefined) return []
  const first = fromDay !== '' && fromDay < firstData ? fromDay : firstData
  const today = todayIso()
  const end = toDay === '' ? today : toDay
  const last = end > lastData && end <= today ? end : lastData
  const start = dayNumber(first)
  const span = dayNumber(last) - start + 1
  if (span > MAX_FILLED_DAYS) return sorted
  const byDay = new Map(sorted.map(row => [row.day, row]))
  return Array.from({ length: span }, (_, offset) => {
    const day = isoFromDayNumber(start + offset)
    return byDay.get(day) ?? { day, costUsd: 0, attempts: 0, inputTokens: 0, outputTokens: 0 }
  })
}

/** Days since the epoch of a YYYY-MM-DD string, in UTC. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
}

/** YYYY-MM-DD of a day number from {@link dayNumber}. */
function isoFromDayNumber(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10)
}

/** Today's local calendar day as YYYY-MM-DD. */
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The inclusive [from, to] range of a preset; '' is an open bound. */
function presetRange(preset: Preset): [string, string] {
  const today = todayIso()
  switch (preset) {
    case 'last7': return [isoFromDayNumber(dayNumber(today) - 6), '']
    case 'last30': return [isoFromDayNumber(dayNumber(today) - 29), '']
    case 'thisMonth': return [`${today.slice(0, 8)}01`, '']
    case 'allTime': return ['', '']
  }
}

/** The preset whose range equals the current filter, if any. */
function activePreset(fromDay: string, toDay: string): Preset | undefined {
  return PRESETS.find((name) => {
    const [from, to] = presetRange(name)
    return from === fromDay && to === toDay
  })
}

/** Round a peak up to 1, 2, 2.5, or 5 times a power of ten for axis ticks. */
function niceCeil(value: number): number {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const nice = [1, 2, 2.5, 5, 10].find(candidate => value / magnitude <= candidate) ?? 10
  return nice * magnitude
}

/** Short "Sep 28" label of a YYYY-MM-DD day. */
function formatDay(day?: string): string {
  if (day === undefined) return ''
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Axis tick label: trimmed amounts from a dime up, otherwise the table format. */
function formatAxis(value: number, currency: CostReportCurrency): string {
  if (value === 0 || value >= 0.1) {
    return new Intl.NumberFormat(localeOf(currency), {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(value)
  }
  return formatMoney(value, currency)
}

/** Last path segment of a workspace path, for compact labels. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(part => part !== '').at(-1) ?? path
}

/**
 * Session ids are long; drop the shared `session-` prefix and keep the head
 * and tail of anything past twelve chars.
 */
function shortSession(sessionId?: string): string {
  if (sessionId === undefined) return '—'
  const id = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`
}

/** Number locale of a display currency: US dollars as en-US, reais as pt-BR. */
function localeOf(currency: CostReportCurrency): string {
  return currency === 'BRL' ? 'pt-BR' : 'en-US'
}

/**
 * An amount in the display currency with enough decimals to keep sub-cent
 * costs readable: two from a dime up, four from a cent, more below.
 */
function formatMoney(value: number, currency: CostReportCurrency): string {
  const digits = value === 0 || value >= 0.1 ? 2 : value >= 0.01 ? 4 : Math.min(8, Math.floor(-Math.log10(value)) + 2)
  return new Intl.NumberFormat(localeOf(currency), {
    style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(value)
}

/** The first and last day of the day rows, or `undefined` without any. */
function dayRange(days: readonly CostReportRow[]): [string, string] | undefined {
  const known = days.map(row => row.day).filter((day): day is string => day !== undefined).sort()
  const first = known[0]
  const last = known.at(-1)
  return first === undefined || last === undefined ? undefined : [first, last]
}

/**
 * Convert every bucket to BRL. Day rows use their own day's rate and sessions
 * the rate of their last active day; model and workspace buckets span days,
 * so they use the period's cost-weighted rate, which keeps their sum equal to
 * the converted daily total.
 */
function convertBuckets(buckets: Buckets, rates: readonly UsdBrlRate[]): Buckets {
  const byDay = new Map(rates.map(row => [row.day, row.rate]))
  const fallback = rates.at(-1)?.rate ?? 0
  const rateOf = (day: string | undefined): number | undefined => (day === undefined ? undefined : byDay.get(day))
  const days = buckets.days.map(row => scaled(row, rateOf(row.day) ?? fallback))
  const usd = buckets.days.reduce((sum, row) => sum + row.costUsd, 0)
  const brl = days.reduce((sum, row) => sum + row.costUsd, 0)
  const period = usd > 0 ? brl / usd : fallback
  return {
    days,
    sessions: buckets.sessions.map(row => scaled(row, rateOf(row.day) ?? period)),
    models: buckets.models.map(row => scaled(row, period)),
    cwds: buckets.cwds.map(row => scaled(row, period)),
  }
}

/** One bucket with its amounts multiplied by an exchange rate. */
function scaled(row: CostReportRow, rate: number): CostReportRow {
  return {
    ...row,
    costUsd: row.costUsd * rate,
    ...(row.billedUsd === undefined ? {} : { billedUsd: row.billedUsd * rate }),
  }
}

/** Where the amounts come from: billed by the provider, estimated, or a mix. */
function sourceNote(days: readonly CostReportRow[], t: Translate): string {
  const total = days.reduce((sum, row) => sum + row.costUsd, 0)
  const billed = days.reduce((sum, row) => sum + (row.billedUsd ?? 0), 0)
  if (billed <= 0 || total <= 0) return t('estimate')
  if (billed >= total * 0.9995) return t('billedAll')
  return t('billedPartial', { value: formatShare(billed / total) })
}

/** Percentage with one decimal under 10%, whole numbers from 10% up. */
function formatShare(value: number): string {
  const percent = value * 100
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`
}

/** Compact token counts (12.3k, 1.2M). */
function formatTokens(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}
