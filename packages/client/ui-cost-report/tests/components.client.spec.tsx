// @vitest-environment jsdom
/**
 * The cost report panel: loading, failure, empty, and ready states, the
 * summary cards, the daily series, the session drill-down, and how each
 * filter edit re-reads the Host ledger.
 */
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CostReportFilter, CostReportModelRow, CostReportRow, UsdBrlRate } from '@deepseek-ai/dsh-api-cost-report/types'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createCostReportStore } from '../src/client/cost-report-store.ts'
import { CostReportPage, type CostReportPageProps } from '../src/client/CostReportPage.tsx'
import { en, type CostReportLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup) // eslint-disable-line @typescript-eslint/no-unsafe-call

const unusedStandardHook = (): never => { throw new Error('The cost report fixture does not provide global state') }
const t: CostReportPageProps['t'] = ((key: CostReportLocaleKey, params?: Record<string, unknown>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as CostReportPageProps['t']

const DAY_ROW: CostReportRow = { day: '2026-09-28', costUsd: 0.5, attempts: 2, inputTokens: 100, outputTokens: 50 }
const SESSION_ROW: CostReportRow = {
  day: '2026-09-28', cwd: '/w1', provider: 'openrouter', model: 'openai/gpt-4o',
  sessionId: 'abcdefghijklmnop', costUsd: 0.0123, attempts: 2, inputTokens: 100, outputTokens: 50,
}

function renderReport(overrides: {
  report?: (group: string, filter: CostReportFilter) => Promise<readonly CostReportRow[]>
  workspaces?: () => Promise<readonly string[]>
  models?: () => Promise<readonly CostReportModelRow[]>
  usdBrlRates?: (fromDay: string, toDay: string) => Promise<readonly UsdBrlRate[]>
} = {}) {
  const instance = createCostReportStore().create()
  const report = overrides.report ?? vi.fn(async () => [DAY_ROW])
  const workspaces = overrides.workspaces ?? vi.fn(async () => ['/w1'])
  const models = overrides.models ?? vi.fn(async () => [{ provider: 'openrouter', model: 'openai/gpt-4o' }])
  const usdBrlRates = overrides.usdBrlRates ?? vi.fn(async () => [])
  const props: CostReportPageProps = {
    useStore: bindSnapshotSelector(instance),
    actions: instance.actions,
    report: report as CostReportPageProps['report'],
    workspaces: workspaces as CostReportPageProps['workspaces'],
    models: models as CostReportPageProps['models'],
    usdBrlRates: usdBrlRates as CostReportPageProps['usdBrlRates'],
    t,
    usePanelInfo: unusedStandardHook,
    useSessions: ((selector: (state: { byId: Record<string, { title?: string }> }) => unknown) =>
      selector({ byId: { abcdefghijklmnop: { title: 'Fix the login bug' } } })) as CostReportPageProps['useSessions'],
    useSessionStatus: unusedStandardHook,
    useSessionRetainInfo: unusedStandardHook,
    useWorkspaces: unusedStandardHook,
    useResource: unusedStandardHook,
  }
  return { view: render(createElement(CostReportPage, props)), props, instance, report, workspaces, models, usdBrlRates }
}

describe('CostReportPage', () => {
  it('reads every bucket group on mount and shows loading until they settle', async () => {
    const report = vi.fn(() => new Promise<readonly CostReportRow[]>(() => { /* never settles */ }))
    const { view, report: reportSpy } = renderReport({ report: report as never })
    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(reportSpy).toHaveBeenCalledWith('day', {})
    expect(reportSpy).toHaveBeenCalledWith('session', {})
    expect(reportSpy).toHaveBeenCalledWith('model', {})
    expect(reportSpy).toHaveBeenCalledWith('cwd', {})
    view.unmount()
  })

  it('surfaces a catalog read failure with an inline retry that reloads options and report', async () => {
    const workspaces = vi.fn<() => Promise<readonly string[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(['/w2'])
    const models = vi.fn(async () => [{ provider: 'openrouter', model: 'openai/gpt-4o' }])
    const report = vi.fn(async () => [DAY_ROW])
    const { view } = renderReport({ report: report as never, workspaces: workspaces as never, models: models as never })
    await screen.findByRole('alert')
    expect(screen.getByText(en.failed.replace('{message}', 'offline'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByRole('button', { name: '/w2' })).toBeTruthy()
    expect(workspaces).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith('day', {})
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount()
  })

  it('surfaces a report failure with a retry that reloads the buckets', async () => {
    const report = vi.fn<() => Promise<readonly CostReportRow[]>>()
      .mockRejectedValueOnce(new Error('ledger locked'))
      .mockResolvedValue([DAY_ROW])
    const { view } = renderReport({ report: report as never })
    await screen.findByRole('alert')
    expect(screen.getByText(en.failed.replace('{message}', 'ledger locked'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(en.total)).toBeTruthy()
    expect(report).toHaveBeenCalledWith('day', {})
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount()
  })

  it('shows the empty state when neither bucket has rows', async () => {
    const report = vi.fn(async () => [])
    const { view } = renderReport({ report: report as never })
    expect(await screen.findByText(en.empty)).toBeTruthy()
    expect(screen.queryByText(en.total)).toBeNull()
    view.unmount()
  })

  it('renders the summary cards from the day buckets', async () => {
    const report = vi.fn(async () => [
      { ...DAY_ROW, costUsd: 0.5, attempts: 2, inputTokens: 100, outputTokens: 50 },
      { ...DAY_ROW, day: '2026-09-29', costUsd: 0.25, attempts: 3, inputTokens: 200, outputTokens: 80 },
    ])
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.total)
    expect(screen.getByText('$0.75')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('300')).toBeTruthy()
    expect(screen.getByText('130')).toBeTruthy()
    view.unmount()
  })

  it('renders the daily series with proportional bars, gap-filled days, and day labels', async () => {
    const report = vi.fn(async () => [
      { ...DAY_ROW, costUsd: 0.1 },
      { ...DAY_ROW, day: '2026-09-30', costUsd: 0.2 },
    ])
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.dailyCost)
    const bars = [...view.container.querySelectorAll<HTMLElement>('[data-bar]')]
    // The axis also runs on through today when the range has no upper bound.
    expect(bars.map(bar => bar.dataset.value).slice(0, 3)).toEqual(['0.1', '0', '0.2'])
    expect(bars.slice(3).every(bar => bar.dataset.value === '0')).toBe(true)
    const heights = bars.map(bar => Number.parseFloat(bar.style.height))
    expect(heights[0]).toBeGreaterThan(0)
    expect(heights[1]).toBe(0)
    expect(heights[2]).toBeGreaterThan(heights[0]!)
    expect(screen.getByLabelText('Sep 29: $0.00')).toBeTruthy()
    expect(screen.getAllByText('Sep 28').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sep 30').length).toBeGreaterThan(0)
    view.unmount()
  })

  it('renders zero-height bars when every day costs nothing', async () => {
    const report = vi.fn(async () => [
      { ...DAY_ROW, costUsd: 0 },
      { ...DAY_ROW, day: '2026-09-29', costUsd: 0 },
    ])
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.dailyCost)
    const heights = [...view.container.querySelectorAll<HTMLElement>('[data-bar]')].map(bar => bar.style.height)
    expect(heights.length).toBeGreaterThanOrEqual(2)
    expect(heights.every(height => height === '0%')).toBe(true)
    view.unmount()
  })

  it('ranks model and workspace breakdowns and filters by the clicked row', async () => {
    const report = vi.fn(async (group: string) => {
      if (group === 'model') {
        return [
          { provider: 'openrouter', model: 'cheap/model', costUsd: 0.25, attempts: 1, inputTokens: 1, outputTokens: 1 },
          { provider: 'openrouter', model: 'pricey/model', costUsd: 0.75, attempts: 1, inputTokens: 1, outputTokens: 1 },
        ]
      }
      if (group === 'cwd') return [{ cwd: 'C:\\Users\\me\\proj', costUsd: 1, attempts: 2, inputTokens: 2, outputTokens: 2 }]
      return [DAY_ROW]
    })
    const { view, instance } = renderReport({ report: report as never })
    await screen.findByText(en.byModel)
    const rows = [...view.container.querySelectorAll('button[title]')].map(el => el.textContent)
    expect(rows.findIndex(text => text?.includes('pricey/model'))).toBeLessThan(rows.findIndex(text => text?.includes('cheap/model')))
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('proj')).toBeTruthy()
    fireEvent.click(screen.getByText('pricey/model'))
    expect(instance.getSnapshot().model).toBe('pricey/model')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('cwd', { model: 'pricey/model' }) })
    view.unmount()
  })

  it('keeps a closed range from running past its upper bound', async () => {
    const report = vi.fn(async () => [{ ...DAY_ROW, day: '2026-09-28' }])
    const { view, instance } = renderReport({ report: report as never })
    instance.actions.setRange('2026-09-27', '2026-09-29')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', { fromDay: '2026-09-27', toDay: '2026-09-29' }) })
    await vi.waitFor(() => {
      expect([...view.container.querySelectorAll<HTMLElement>('[data-bar]')].map(bar => bar.dataset.value)).toEqual(['0', '0.5', '0'])
    })
    view.unmount()
  })

  it('reports cache reads as the share of prompt tokens served from cache', async () => {
    const report = vi.fn(async () => [{ ...DAY_ROW, inputTokens: 100, cacheReadTokens: 900 }])
    const { view } = renderReport({ report: report as never })
    expect((await screen.findAllByText('1K')).length).toBeGreaterThan(0)
    expect(screen.getByText(en.cacheHitRate.replace('{value}', '90%'))).toBeTruthy()
    view.unmount()
  })

  it('labels sessions that used several models', async () => {
    const report = vi.fn(async (group: string) => (group === 'session'
      ? [{ sessionId: 'mixed', day: '2026-09-28', costUsd: 0.1, attempts: 1, inputTokens: 1, outputTokens: 1 }]
      : group === 'day' ? [DAY_ROW] : []))
    const { view } = renderReport({ report: report as never })
    expect(await screen.findByText(en.mixedModels)).toBeTruthy()
    view.unmount()
  })

  it('applies a quick range preset as an open-ended range', async () => {
    const report = vi.fn(async () => [DAY_ROW])
    const { view, instance } = renderReport({ report: report as never })
    fireEvent.click(screen.getByRole('button', { name: en.last7 }))
    expect(instance.getSnapshot().fromDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(instance.getSnapshot().toDay).toBe('')
    fireEvent.click(screen.getByRole('button', { name: en.allTime }))
    expect(instance.getSnapshot().fromDay).toBe('')
    view.unmount()
  })

  it('shows the session title when the client session list knows it', async () => {
    const report = vi.fn(async (group: string) => (group === 'session' ? [SESSION_ROW] : [DAY_ROW]))
    const { view } = renderReport({ report: report as never })
    expect(await screen.findByText('Fix the login bug')).toBeTruthy()
    view.unmount()
  })

  it('collapses long session lists behind a show-all toggle', async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({ ...SESSION_ROW, sessionId: `s-${index}`, costUsd: 0.5 }))
    const report = vi.fn(async (group: string) => (group === 'session' ? sessions : [DAY_ROW]))
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.sessions)
    expect(screen.queryByText('s-11')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.showAll.replace('{count}', '12') }))
    expect(screen.getByText('s-11')).toBeTruthy()
    view.unmount()
  })

  it('formats session costs at every magnitude and shortens long ids', async () => {
    const sessions: CostReportRow[] = [
      { ...SESSION_ROW, sessionId: 'zero', costUsd: 0 },
      { ...SESSION_ROW, sessionId: 'short', costUsd: 0.5 },
      { ...SESSION_ROW, sessionId: 'abcdefghijklmnop', costUsd: 0.05 },
      { ...SESSION_ROW, sessionId: 'abcdefghijklmnopqrst', costUsd: 0.0005 },
    ]
    const report = vi.fn(async (group: string) => (group === 'session' ? sessions : group === 'day' ? [{ ...DAY_ROW, costUsd: 0.25 }] : []))
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.sessions)
    expect(screen.getByText('$0.00')).toBeTruthy()
    expect(screen.getByText('$0.50')).toBeTruthy()
    expect(screen.getByText('$0.0500')).toBeTruthy()
    expect(screen.getByText('$0.00050')).toBeTruthy()
    expect(screen.getByText('short')).toBeTruthy()
    expect(screen.getByText('abcdefgh…mnop')).toBeTruthy()
    expect(screen.getByText('abcdefgh…qrst')).toBeTruthy()
    expect(screen.queryAllByText('—')).toHaveLength(0)
    view.unmount()
  })

  it('fills the session table dash for missing session ids', async () => {
    const sessions: CostReportRow[] = [{
      day: '2026-09-28', cwd: '/w1', provider: 'openrouter', model: 'openai/gpt-4o',
      costUsd: 0.0123, attempts: 2, inputTokens: 100, outputTokens: 50,
    }]
    const report = vi.fn(async (group: string) => (group === 'session' ? sessions : group === 'day' ? [DAY_ROW] : []))
    const { view } = renderReport({ report: report as never })
    await screen.findByText(en.sessions)
    expect(screen.getByText('—')).toBeTruthy()
    view.unmount()
  })

  it('narrows the report to the clicked workspace and back to all', async () => {
    const report = vi.fn(async () => [DAY_ROW])
    const { view, instance } = renderReport({ report: report as never })
    await screen.findByText(en.workspace)
    fireEvent.click(screen.getByRole('button', { name: '/w1' }))
    expect(instance.getSnapshot().cwd).toBe('/w1')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', { cwd: '/w1' }) })
    // The workspace and model rows each carry an "All" reset pill; pick the workspace one.
    fireEvent.click(screen.getAllByRole('button', { name: en.all })[0]!)
    expect(instance.getSnapshot().cwd).toBeNull()
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', {}) })
    view.unmount()
  })

  it('narrows the report to the clicked model and back to all', async () => {
    const report = vi.fn(async () => [DAY_ROW])
    const { view, instance } = renderReport({ report: report as never })
    await screen.findByText(en.total)
    fireEvent.click(screen.getByRole('button', { name: 'openai/gpt-4o' }))
    expect(instance.getSnapshot().model).toBe('openai/gpt-4o')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', { model: 'openai/gpt-4o' }) })
    fireEvent.click(screen.getAllByRole('button', { name: en.all })[1]!)
    expect(instance.getSnapshot().model).toBeNull()
    view.unmount()
  })

  it('re-reads the report when the date range changes', async () => {
    const report = vi.fn(async () => [DAY_ROW])
    const { view, instance } = renderReport({ report: report as never })
    const from = screen.getByLabelText(en.from) as HTMLInputElement
    fireEvent.change(from, { target: { value: '2026-09-01' } })
    expect(instance.getSnapshot().fromDay).toBe('2026-09-01')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', { fromDay: '2026-09-01' }) })
    fireEvent.change(from, { target: { value: '' } })
    const to = screen.getByLabelText(en.to) as HTMLInputElement
    fireEvent.change(to, { target: { value: '2026-09-30' } })
    expect(instance.getSnapshot().toDay).toBe('2026-09-30')
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('day', { toDay: '2026-09-30' }) })
    view.unmount()
  })

  it('refreshes all reads when the options catalog reloads after a failed model read', async () => {
    const models = vi.fn<() => Promise<readonly CostReportModelRow[]>>()
      .mockRejectedValueOnce(new Error('catalog offline'))
      .mockResolvedValueOnce([{ provider: 'openrouter', model: 'openai/gpt-4o' }])
    const report = vi.fn(async () => [DAY_ROW])
    const { view } = renderReport({ report: report as never, models: models as never })
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByRole('button', { name: 'openai/gpt-4o' })).toBeTruthy()
    expect(models).toHaveBeenCalledTimes(2)
    view.unmount()
  })
  it('converts every amount to BRL at the rate of its day without re-reading the ledger', async () => {
    const report = vi.fn(async (group: string) => (group === 'day'
      ? [DAY_ROW, { ...DAY_ROW, day: '2026-09-29', costUsd: 1 }]
      : group === 'model'
        ? [{ provider: 'openrouter', model: 'openai/gpt-4o', costUsd: 1.5, attempts: 4, inputTokens: 200, outputTokens: 100 }]
        : []))
    const usdBrlRates = vi.fn(async () => [
      { day: '2026-09-28', rate: 5, bulletinDay: '2026-09-26' },
      { day: '2026-09-29', rate: 6, bulletinDay: '2026-09-29' },
    ])
    const { view } = renderReport({ report: report as never, usdBrlRates })
    expect(await screen.findByText(en.total)).toBeTruthy()
    expect(screen.getAllByText('$1.50').length).toBeGreaterThan(0)
    const reads = report.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'BRL' }))
    expect(await screen.findByText(en.fxNote)).toBeTruthy()
    expect(usdBrlRates).toHaveBeenCalledWith('2026-09-28', '2026-09-29')
    // 0.5 × 5 + 1 × 6 = 8.50; the model bucket takes the same weighted rate.
    expect(screen.getAllByText(/R\$\s8,50/).length).toBeGreaterThanOrEqual(2)
    expect(report.mock.calls.length).toBe(reads)
    view.unmount()
  })

  it('keeps USD amounts and says so when the exchange rates are unavailable', async () => {
    const usdBrlRates = vi.fn(async () => { throw new Error('offline') })
    const { view } = renderReport({ usdBrlRates })
    expect(await screen.findByText(en.total)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'BRL' }))
    expect(await screen.findByText(en.fxUnavailable)).toBeTruthy()
    expect(screen.getAllByText('$0.50').length).toBeGreaterThan(0)
    view.unmount()
  })

  it('states when the amounts are what the provider billed', async () => {
    const report = vi.fn(async (group: string) => (group === 'day' ? [{ ...DAY_ROW, billedUsd: 0.5 }] : []))
    const { view } = renderReport({ report: report as never })
    expect(await screen.findByText(en.billedAll)).toBeTruthy()
    view.unmount()
  })
})
