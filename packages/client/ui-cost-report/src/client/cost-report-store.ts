/**
 * Panel filter state shared across main-panel remounts: switching to another
 * panel unmounts the page, and the store keeps the range and toggles a user
 * chose. Empty day strings mean an open bound; null cwd/model mean "any".
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Display currency of the panel's amounts; BRL converts at each day's PTAX. */
export type CostReportCurrency = 'USD' | 'BRL'

/** The panel's inclusive day range, workspace/model toggles, and display currency. */
export type CostReportFilters = {
  fromDay: string
  toDay: string
  cwd: string | null
  model: string | null
  currency: CostReportCurrency
}

type CostReportActions = {
  /** Replace the inclusive day range; '' removes a bound. */
  setRange: (draft: CostReportFilters, fromDay: string, toDay: string) => void
  /** Select or clear the workspace filter. */
  setCwd: (draft: CostReportFilters, cwd: string | null) => void
  /** Select or clear the model filter. */
  setModel: (draft: CostReportFilters, model: string | null) => void
  /** Switch the display currency. */
  setCurrency: (draft: CostReportFilters, currency: CostReportCurrency) => void
}

/**
 * Create the registration-owned filter store before the first page render.
 * @returns the store handle; `create()` yields the single shared instance.
 */
export function createCostReportStore(): EngineStoreHandle<CostReportFilters, CostReportActions> {
  return defineStore({
    init: (): CostReportFilters => ({ fromDay: '', toDay: '', cwd: null, model: null, currency: 'USD' }),
    actions: {
      setRange: (draft, fromDay, toDay) => {
        draft.fromDay = fromDay
        draft.toDay = toDay
      },
      setCwd: (draft, cwd) => { draft.cwd = cwd },
      setModel: (draft, model) => { draft.model = model },
      setCurrency: (draft, currency) => { draft.currency = currency },
    },
  })
}
