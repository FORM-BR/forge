/**
 * USD→BRL daily rates from the Central Bank of Brazil's PTAX bulletin (the
 * official closing rate, selling side), for showing ledger costs in reais at
 * the rate of the day each call happened. Host-only: it fetches and caches on
 * disk, so it never reaches the browser.
 *
 * PTAX is published once per business day around 13:00 BRT. A day without a
 * bulletin (weekend, holiday, or today before publication) uses the latest
 * earlier bulletin, the convention for converting at "the day's rate".
 *
 * @module @deepseek-ai/dsh-cost-meter/usd-brl
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** The BCB Olinda OData service for the dollar PTAX over a date range. */
export const PTAX_PERIOD_URL = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/'
  + 'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'

/** Days fetched before a requested range so its first days have a prior bulletin. */
const LOOKBACK_DAYS = 10

const DAY_MS = 86_400_000

/** Minimum wait before re-querying a range that is not final yet (today's bulletin). */
const REFETCH_AFTER_MS = 30 * 60_000

/** One calendar day's USD→BRL rate. */
export interface UsdBrlRate {
  /** Calendar day, YYYY-MM-DD. */
  readonly day: string
  /** BRL per USD: the PTAX selling rate of that day or the latest earlier bulletin. */
  readonly rate: number
  /** Business day of the PTAX bulletin the rate comes from. */
  readonly bulletinDay: string
}

/** On-disk cache: published bulletins and the range already fetched. */
interface PtaxCacheFile {
  readonly version: 1
  /** Bulletin day (YYYY-MM-DD) to PTAX selling rate. */
  readonly bulletins: Readonly<Record<string, number>>
  /** First day whose bulletins are known, or `null` before the first fetch. */
  readonly coveredFrom: string | null
  /** Last finished day (before the fetch day) whose bulletins are final. */
  readonly coveredThrough: string | null
}

/** Options for {@link UsdBrlRateTable}. */
export interface UsdBrlRateTableOptions {
  /** On-disk cache path. Defaults to `~/.dsh/statistics/usd-brl-ptax.json`. */
  readonly cachePath?: string
  /** HTTP client, injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch
  /** Clock, injectable for tests. */
  readonly now?: () => number
}

/** YYYY-MM-DD of an epoch-millisecond instant in the host time zone. */
function localDay(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Shift a YYYY-MM-DD day by whole days. */
function addDays(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** The PTAX query's MM-DD-YYYY spelling of a YYYY-MM-DD day. */
function ptaxDate(day: string): string {
  return `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}`
}

/**
 * Parse a PTAX `CotacaoDolarPeriodo` response into bulletin day → selling rate.
 * Entries without a positive finite rate or a dated timestamp are skipped;
 * when a day has several bulletins the last one (the closing PTAX) wins.
 * @param payload - the decoded JSON body.
 * @returns bulletin day to BRL per USD.
 */
export function ptaxPayloadToBulletins(payload: unknown): Map<string, number> {
  const bulletins = new Map<string, number>()
  if (typeof payload !== 'object' || payload === null) return bulletins
  const value = (payload as { value?: unknown }).value
  if (!Array.isArray(value)) return bulletins
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const { cotacaoVenda, dataHoraCotacao } = entry as { cotacaoVenda?: unknown; dataHoraCotacao?: unknown }
    if (typeof cotacaoVenda !== 'number' || !Number.isFinite(cotacaoVenda) || cotacaoVenda <= 0) continue
    if (typeof dataHoraCotacao !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dataHoraCotacao)) continue
    bulletins.set(dataHoraCotacao.slice(0, 10), cotacaoVenda)
  }
  return bulletins
}

/**
 * Daily USD→BRL table over the PTAX bulletins, cached on disk. A failed fetch
 * leaves the cached bulletins in place, so an offline host still converts the
 * days it fetched before; days with no bulletin on or before them are omitted.
 */
export class UsdBrlRateTable {
  private readonly cachePath: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private cache: PtaxCacheFile | undefined
  /** Last query time per unfinished range, so panel reloads do not hammer the service. */
  private readonly attempts = new Map<string, number>()

  /** @param options - cache location and injectable fetch/clock. */
  constructor(options: UsdBrlRateTableOptions = {}) {
    this.cachePath = options.cachePath ?? dshHomePath('statistics', 'usd-brl-ptax.json')
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  /**
   * The rate of every calendar day in an inclusive range, fetching the
   * bulletins the cache does not cover yet.
   * @param fromDay - first day, YYYY-MM-DD.
   * @param toDay - last day, YYYY-MM-DD; days after today are clamped to today.
   * @returns one row per day that has a bulletin on or before it, ascending.
   */
  async rates(fromDay: string, toDay: string): Promise<UsdBrlRate[]> {
    const today = localDay(this.now())
    const last = toDay > today ? today : toDay
    if (fromDay > last) return []
    await this.ensureCovered(addDays(fromDay, -LOOKBACK_DAYS), last, today)
    const bulletins = this.load().bulletins
    const known = Object.keys(bulletins).sort()
    const rows: UsdBrlRate[] = []
    let cursor = 0
    let bulletinDay: string | undefined
    for (let day = addDays(fromDay, -LOOKBACK_DAYS); day <= last; day = addDays(day, 1)) {
      while (cursor < known.length && (known[cursor] ?? '') <= day) {
        bulletinDay = known[cursor]
        cursor += 1
      }
      if (day < fromDay || bulletinDay === undefined) continue
      const rate = bulletins[bulletinDay]
      if (rate !== undefined) rows.push({ day, rate, bulletinDay })
    }
    return rows
  }

  /** Fetch the parts of [start, end] outside the finished, cached range. */
  private async ensureCovered(start: string, end: string, today: string): Promise<void> {
    const cache = this.load()
    const gaps: Array<[string, string]> = []
    if (cache.coveredFrom === null || cache.coveredThrough === null) {
      gaps.push([start, end])
    } else {
      if (start < cache.coveredFrom) gaps.push([start, addDays(cache.coveredFrom, -1)])
      if (end > cache.coveredThrough) gaps.push([addDays(cache.coveredThrough, 1), end])
    }
    if (gaps.length === 0) return
    const bulletins = { ...cache.bulletins }
    let coveredFrom = cache.coveredFrom
    let coveredThrough = cache.coveredThrough
    for (const [from, to] of gaps) {
      // A gap reaching today is the pending tail; one key per day so a
      // different request range does not bypass the throttle.
      const key = to >= today ? `tail|${today}` : `${from}|${to}`
      const attempted = this.attempts.get(key)
      if (attempted !== undefined && this.now() - attempted < REFETCH_AFTER_MS) continue
      this.attempts.set(key, this.now())
      const fetched = await this.fetchRange(from, to)
      if (fetched === undefined) continue
      for (const [day, rate] of fetched) bulletins[day] = rate
      // Only finished days are final: today's bulletin may still be pending.
      const finished = to < today ? to : addDays(today, -1)
      if (coveredFrom === null || from < coveredFrom) coveredFrom = from
      if (finished >= from && (coveredThrough === null || finished > coveredThrough)) coveredThrough = finished
    }
    this.cache = { version: 1, bulletins, coveredFrom, coveredThrough }
    this.save()
  }

  /** One PTAX range query; `undefined` on any network or decode failure. */
  private async fetchRange(from: string, to: string): Promise<Map<string, number> | undefined> {
    const url = `${PTAX_PERIOD_URL}?@dataInicial='${ptaxDate(from)}'&@dataFinalCotacao='${ptaxDate(to)}'`
      + '&$format=json&$select=cotacaoVenda,dataHoraCotacao'
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return undefined
      return ptaxPayloadToBulletins(await response.json())
    } catch {
      return undefined
    }
  }

  /** The cache file, or an empty cache when it is absent or unreadable. */
  private load(): PtaxCacheFile {
    if (this.cache !== undefined) return this.cache
    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as Partial<PtaxCacheFile>
      if (parsed.version === 1 && typeof parsed.bulletins === 'object' && parsed.bulletins !== null) {
        this.cache = {
          version: 1,
          bulletins: parsed.bulletins,
          coveredFrom: typeof parsed.coveredFrom === 'string' ? parsed.coveredFrom : null,
          coveredThrough: typeof parsed.coveredThrough === 'string' ? parsed.coveredThrough : null,
        }
        return this.cache
      }
    } catch {
      // Absent or corrupt: start empty and refetch.
    }
    this.cache = { version: 1, bulletins: {}, coveredFrom: null, coveredThrough: null }
    return this.cache
  }

  /** Persist the cache; a write failure only costs a refetch next boot. */
  private save(): void {
    if (this.cache === undefined) return
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true, mode: 0o700 })
      writeFileSync(this.cachePath, JSON.stringify(this.cache), 'utf8')
    } catch {
      // Best effort.
    }
  }
}
