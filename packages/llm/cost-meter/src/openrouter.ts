/**
 * OpenRouter live price table: USD-per-1M-token rates resolved from
 * `GET https://openrouter.ai/api/v1/models`. Host-only — it fetches and caches
 * on disk, so it never reaches the browser.
 *
 * The endpoint's `pricing` object quotes USD per token; this module converts
 * to the model rates shape (USD per 1M tokens) used by the cost fold.
 *
 * @module @deepseek-ai/dsh-cost-meter/openrouter
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ModelCostRates, PriceLookup } from './rates.ts'

/** The OpenRouter public model catalog endpoint. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Default freshness window for the price cache before a refetch. */
export const DEFAULT_PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const PER_MILLION = 1_000_000

/**
 * Provider ids whose traffic routes through OpenRouter and may therefore be
 * priced against the live table. `openrouterv1` is the personal profile's
 * custom provider id; `openrouter` is the pi-ai builtin name.
 */
const OPENROUTER_PROVIDER_IDS = new Set(['openrouter', 'openrouterv1'])

/** Whether the provider routes through OpenRouter. */
export function isOpenRouterProvider(provider: string): boolean {
  return OPENROUTER_PROVIDER_IDS.has(provider)
}

/**
 * Normalize a model id stored by the runtime: OpenRouter prefixes "latest"
 * aliases with `~` (`~deepseek/deepseek-v4-flash-latest`), while the models
 * catalog and the live table key by the plain id.
 */
export function normalizeOpenRouterModel(model: string): string {
  return model.startsWith('~') ? model.slice(1) : model
}

/** On-disk cache file content. */
export interface OpenRouterPriceCacheFile {
  /** Epoch milliseconds when the table was fetched. */
  readonly fetchedAt: number
  /** Model id (already normalized) to USD-per-1M-token rates. */
  readonly models: Readonly<Record<string, ModelCostRates>>
}

const OPENROUTER_PRICE_CACHE_VERSION = 1

const CACHE_HEADER = {
  version: OPENROUTER_PRICE_CACHE_VERSION,
} as const

/** Options for {@link OpenRouterPriceTable}. */
export interface OpenRouterPriceTableOptions {
  /**
   * On-disk price cache path. Defaults to `~/.dsh/statistics/openrouter-prices.json`.
   */
  readonly cachePath?: string
  /** Freshness window in milliseconds after which a refetch is attempted. */
  readonly ttlMs?: number
  /** HTTP client, injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  return undefined
}

/**
 * Convert one model entry's `pricing` object (USD per token) to model rates
 * (USD per 1M tokens). `prompt` and `completion` must both be finite
 * non-negative numbers; otherwise the entry is unpriced and `undefined`.
 */
export function openRouterRatesFromPricing(pricing: {
  readonly prompt?: unknown
  readonly completion?: unknown
}): ModelCostRates | undefined {
  const prompt = numberOrUndefined(pricing.prompt)
  const completion = numberOrUndefined(pricing.completion)
  if (prompt === undefined || completion === undefined) return undefined
  return {
    // OpenRouter does not publish a cache-hit discount in `pricing`; charge
    // cache reads at half the input rate as a documented approximation and
    // cache writes at zero (not a separately billed bucket).
    input: roundMillion(prompt),
    output: roundMillion(completion),
    cacheRead: roundMillion(prompt / 2),
    cacheWrite: 0,
  }
}

/** USD-per-1M-token value rounded to 8 decimals, away from float noise. */
function roundMillion(perToken: number): number {
  return Math.round(perToken * PER_MILLION * 1e8) / 1e8
}

/**
 * Parse a `GET /api/v1/models` response body into normalized model-id rates.
 * Malformed or unpriced entries are skipped; an entry that cannot be parsed
 * at all leaves the whole table empty rather than silently partial.
 */
export function openRouterModelsPayloadToRates(payload: unknown): ReadonlyMap<string, ModelCostRates> {
  const rates = new Map<string, ModelCostRates>()
  if (typeof payload !== 'object' || payload === null) return rates
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return rates
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const model = (entry as { id?: unknown }).id
    const pricing = (entry as { pricing?: unknown }).pricing
    if (typeof model !== 'string' || model.length === 0 || typeof pricing !== 'object' || pricing === null) {
      continue
    }
    const converted = openRouterRatesFromPricing(pricing as { prompt?: unknown; completion?: unknown })
    if (converted !== undefined) rates.set(normalizeOpenRouterModel(model), converted)
  }
  return rates
}

/**
 * Lifetime price table for OpenRouter-routed models. Lookups are synchronous
 * against the in-memory snapshot; `ensureLoaded()` refreshes it from the live
 * endpoint or the on-disk cache and never throws, so an offline process or a
 * missing key degrades to "no price known" exactly like an unpriced model.
 */
export class OpenRouterPriceTable {
  private readonly rates = new Map<string, ModelCostRates>()
  private readonly cachePath: string
  private readonly ttlMs: number
  private readonly fetchImpl: typeof fetch
  private loadedAt = 0

  constructor(options: OpenRouterPriceTableOptions = {}) {
    this.cachePath = options.cachePath ?? dshHomePath('statistics', 'openrouter-prices.json')
    this.ttlMs = options.ttlMs ?? DEFAULT_PRICE_CACHE_TTL_MS
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /**
   * Synchronous price for one route, or `undefined` when no price is known.
   * Non-OpenRouter providers never resolve here.
   */
  lookup(provider: string, model: string): ModelCostRates | undefined {
    if (!isOpenRouterProvider(provider)) return undefined
    return this.rates.get(normalizeOpenRouterModel(model))
  }

  /** This table's lookup as a host {@link PriceLookup}. */
  asPriceLookup(): PriceLookup {
    return (provider, model) => this.lookup(provider, model)
  }

  /**
   * Seed the in-memory table from the on-disk cache without any network I/O,
   * so a caller that must fold history synchronously starts from a usable
   * snapshot instead of an empty table. Stale copies are applied too: an old
   * price is closer to the truth than none, and a later `ensureLoaded()`
   * refreshes it once the TTL has passed.
   */
  loadDiskCache(): void {
    if (this.rates.size > 0) return
    const cached = this.readCache()
    if (cached === undefined) return
    this.applyCache(cached)
  }

  /** Whether the in-memory table currently holds at least one price. */
  hasPrices(): boolean {
    return this.rates.size > 0
  }

  /**
   * Ensure an in-memory snapshot exists and is fresh: serve the in-memory
   * table if fresh, else the on-disk cache if fresh, else fetch. A failed
   * fetch falls back to any cached copy regardless of age. Never throws.
   * @param now - current epoch milliseconds; injectable for tests.
   */
  async ensureLoaded(now: number = Date.now()): Promise<void> {
    if (this.rates.size > 0 && now - this.loadedAt < this.ttlMs) return
    const cached = this.readCache()
    if (cached !== undefined && now - cached.fetchedAt < this.ttlMs) {
      this.applyCache(cached)
      return
    }
    try {
      await this.fetchAndStore(now)
    } catch {
      // Network or parse failure: degrade to the cached copy if any. The
      // price table is best-effort; absence reads as "unpriced".
      const fallback = this.readCache()
      if (fallback !== undefined) this.applyCache(fallback)
    }
  }

  /** Persist a snapshot as the on-disk cache; best-effort, never throws. */
  snapshot(now: number = Date.now()): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true, mode: 0o700 })
      writeFileSync(this.cachePath, JSON.stringify({
        ...CACHE_HEADER,
        fetchedAt: now,
        models: Object.fromEntries(this.rates),
      } satisfies OpenRouterPriceCacheFile & typeof CACHE_HEADER), 'utf8')
    } catch {
      // A read-only home must not take the meter down; the in-memory table
      // still prices the session.
    }
  }

  private readCache(): OpenRouterPriceCacheFile | undefined {
    try {
      const raw = JSON.parse(readFileSync(this.cachePath, 'utf8')) as {
        version?: unknown
        fetchedAt?: unknown
        models?: unknown
      }
      if (
        raw.version !== OPENROUTER_PRICE_CACHE_VERSION
        || typeof raw.fetchedAt !== 'number'
        || typeof raw.models !== 'object'
        || raw.models === null
      ) {
        return undefined
      }
      const models: Record<string, ModelCostRates> = {}
      for (const [id, value] of Object.entries(raw.models)) {
        if (typeof value !== 'object' || value === null) continue
        const rates = value as { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown }
        const input = numberOrUndefined(rates.input)
        const output = numberOrUndefined(rates.output)
        if (input === undefined || output === undefined) continue
        models[id] = {
          input,
          output,
          cacheRead: numberOrUndefined(rates.cacheRead) ?? 0,
          cacheWrite: numberOrUndefined(rates.cacheWrite) ?? 0,
        }
      }
      return { fetchedAt: raw.fetchedAt, models }
    } catch {
      return undefined
    }
  }

  private applyCache(cached: OpenRouterPriceCacheFile): void {
    this.rates.clear()
    for (const [id, rates] of Object.entries(cached.models)) this.rates.set(id, rates)
    this.loadedAt = cached.fetchedAt
  }

  private async fetchAndStore(now: number): Promise<void> {
    const response = await this.fetchImpl(OPENROUTER_MODELS_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`OpenRouter models request failed with ${response.status}`)
    const payload: unknown = await response.json()
    const fetched = openRouterModelsPayloadToRates(payload)
    this.rates.clear()
    for (const [id, rates] of fetched) this.rates.set(id, rates)
    this.loadedAt = now
    this.snapshot(now)
  }
}

/**
 * Compose one lookup from several, in order: the first lookup that resolves
 * the route wins, so callers can prefer live OpenRouter prices and fall back
 * to the installed catalog for other providers.
 */
export function composePriceLookup(...lookups: readonly (PriceLookup | undefined)[]): PriceLookup {
  const live = lookups.filter((lookup): lookup is PriceLookup => lookup !== undefined)
  return (provider, model) => {
    for (const lookup of live) {
      const rates = lookup(provider, model)
      if (rates !== undefined) return rates
    }
    return undefined
  }
}