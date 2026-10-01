import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composePriceLookup,
  isOpenRouterProvider,
  normalizeOpenRouterModel,
  openRouterModelsPayloadToRates,
  openRouterRatesFromPricing,
  OpenRouterPriceTable,
} from '@deepseek-ai/dsh-cost-meter/src/openrouter.ts'
import type { PriceLookup } from '@deepseek-ai/dsh-cost-meter/client'

const LIVE_PAYLOAD = {
  data: [
    { id: 'deepseek/deepseek-v4.1-flash', pricing: { prompt: '0.00000005', completion: '0.0000001' } },
    // Aliased "latest" id comes back without the tilde on the live table.
    { id: 'deepseek/deepseek-v4-flash-latest', pricing: { prompt: 0.00000005, completion: 0.0000001 } },
    { id: 'free/model', pricing: {} },
    { id: 'bad', pricing: 'nope' },
  ],
}

function fetchOk(payload: unknown): typeof fetch {
  return async (): Promise<Response> => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchThrows(): typeof fetch {
  return async (): Promise<Response> => { throw new Error('network down') }
}

/** A temp cache path per test so table tests never touch the real home. */
function tempCachePath(): { cachePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cost-openrouter-'))
  return { cachePath: join(dir, 'prices.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('isOpenRouterProvider', () => {
  it('recognizes the builtin and the custom profile provider ids', () => {
    expect(isOpenRouterProvider('openrouter')).toBe(true)
    expect(isOpenRouterProvider('openrouterv1')).toBe(true)
    expect(isOpenRouterProvider('deepseek')).toBe(false)
    expect(isOpenRouterProvider('')).toBe(false)
  })
})

describe('normalizeOpenRouterModel', () => {
  it('strips the "latest" tilde alias prefix', () => {
    expect(normalizeOpenRouterModel('~deepseek/deepseek-v4-flash-latest')).toBe('deepseek/deepseek-v4-flash-latest')
    expect(normalizeOpenRouterModel('deepseek/deepseek-v4.1-flash')).toBe('deepseek/deepseek-v4.1-flash')
  })
})

describe('openRouterRatesFromPricing', () => {
  it('converts USD-per-token pricing to USD-per-1M-token rates', () => {
    expect(openRouterRatesFromPricing({ prompt: '0.00000005', completion: '0.0000001' })).toEqual({
      input: 0.05,
      output: 0.1,
      cacheRead: 0.025,
      cacheWrite: 0,
    })
  })

  it('accepts numeric pricing', () => {
    expect(openRouterRatesFromPricing({ prompt: 0.05, completion: 0.1 })).toEqual({
      input: 50_000,
      output: 100_000,
      cacheRead: 25_000,
      cacheWrite: 0,
    })
  })

  it('is undefined when prompt or completion is missing, negative, or not a finite number', () => {
    expect(openRouterRatesFromPricing({})).toBeUndefined()
    expect(openRouterRatesFromPricing({ prompt: 'abc', completion: '0.1' })).toBeUndefined()
    expect(openRouterRatesFromPricing({ prompt: '-1', completion: '0.1' })).toBeUndefined()
    expect(openRouterRatesFromPricing({ prompt: 'NaN', completion: '0.1' })).toBeUndefined()
  })
})

describe('openRouterModelsPayloadToRates', () => {
  it('normalizes ids and skips unpriced or malformed entries', () => {
    const rates = openRouterModelsPayloadToRates(LIVE_PAYLOAD)
    expect(rates.size).toBe(2)
    expect(rates.get('deepseek/deepseek-v4.1-flash')).toEqual({ input: 0.05, output: 0.1, cacheRead: 0.025, cacheWrite: 0 })
    expect(rates.has('~deepseek/deepseek-v4-flash-latest')).toBe(false)
    expect(rates.get('deepseek/deepseek-v4-flash-latest')).toEqual({ input: 0.05, output: 0.1, cacheRead: 0.025, cacheWrite: 0 })
  })

  it('returns an empty map for non-object or data-less payloads', () => {
    expect(openRouterModelsPayloadToRates(null).size).toBe(0)
    expect(openRouterModelsPayloadToRates({}).size).toBe(0)
    expect(openRouterModelsPayloadToRates({ data: 'nope' }).size).toBe(0)
  })
})

describe('OpenRouterPriceTable', () => {
  it('fetches the live table and serves normalized lookups for openrouter providers', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const table = new OpenRouterPriceTable({ fetch: fetchOk(LIVE_PAYLOAD), ttlMs: 60_000, cachePath })
      await table.ensureLoaded(1_000)
      // The stored id carries the tilde; the normalized lookup must match.
      expect(table.lookup('openrouterv1', '~deepseek/deepseek-v4-flash-latest')).toEqual({
        input: 0.05, output: 0.1, cacheRead: 0.025, cacheWrite: 0,
      })
      expect(table.lookup('openrouter', 'deepseek/deepseek-v4.1-flash')).toBeDefined()
    } finally {
      cleanup()
    }
  })

  it('never resolves non-OpenRouter providers or unpriced models', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const table = new OpenRouterPriceTable({ fetch: fetchOk(LIVE_PAYLOAD), ttlMs: 60_000, cachePath })
      await table.ensureLoaded(1_000)
      expect(table.lookup('deepseek', 'deepseek/deepseek-v4.1-flash')).toBeUndefined()
      expect(table.lookup('openrouterv1', 'free/model')).toBeUndefined()
      expect(table.lookup('openrouterv1', 'no/such-model')).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('is undefined before any load and after a failed fetch without a cache', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const table = new OpenRouterPriceTable({ fetch: fetchThrows(), ttlMs: 60_000, cachePath })
      await table.ensureLoaded(1_000)
      expect(table.lookup('openrouterv1', 'deepseek/deepseek-v4.1-flash')).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('falls back to the on-disk cache when the fetch fails', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const first = new OpenRouterPriceTable({ fetch: fetchOk(LIVE_PAYLOAD), ttlMs: 60_000, cachePath })
      await first.ensureLoaded(1_000)
      first.snapshot(1_000)

      const offline = new OpenRouterPriceTable({ fetch: fetchThrows(), ttlMs: 60_000, cachePath })
      await offline.ensureLoaded(2_000)
      expect(offline.lookup('openrouterv1', '~deepseek/deepseek-v4-flash-latest')).toBeDefined()
    } finally {
      cleanup()
    }
  })

  it('serves a fresh on-disk cache without fetching', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const first = new OpenRouterPriceTable({ fetch: fetchOk(LIVE_PAYLOAD), ttlMs: 60_000, cachePath })
      await first.ensureLoaded(1_000)
      first.snapshot(1_000)

      let fetchCount = 0
      const counting = async (): Promise<Response> => { fetchCount += 1; return new Response('{}', { status: 200 }) }
      const second = new OpenRouterPriceTable({ fetch: counting, ttlMs: 60_000, cachePath })
      await second.ensureLoaded(2_000)
      expect(fetchCount).toBe(0)
      expect(second.lookup('openrouterv1', 'deepseek/deepseek-v4.1-flash')).toBeDefined()
    } finally {
      cleanup()
    }
  })

  it('seeds synchronously from the on-disk cache without any fetch', async () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const first = new OpenRouterPriceTable({ fetch: fetchOk(LIVE_PAYLOAD), ttlMs: 60_000, cachePath })
      await first.ensureLoaded(1_000)
      first.snapshot(1_000)

      const seeded = new OpenRouterPriceTable({ fetch: fetchThrows(), ttlMs: 60_000, cachePath })
      expect(seeded.hasPrices()).toBe(false)
      expect(seeded.lookup('openrouterv1', 'deepseek/deepseek-v4.1-flash')).toBeUndefined()

      seeded.loadDiskCache()
      expect(seeded.hasPrices()).toBe(true)
      expect(seeded.lookup('openrouterv1', '~deepseek/deepseek-v4-flash-latest')).toEqual({
        input: 0.05, output: 0.1, cacheRead: 0.025, cacheWrite: 0,
      })
    } finally {
      cleanup()
    }
  })

  it('stays unpriced when the cache file is absent', () => {
    const { cachePath, cleanup } = tempCachePath()
    try {
      const table = new OpenRouterPriceTable({ fetch: fetchThrows(), ttlMs: 60_000, cachePath })
      table.loadDiskCache()
      expect(table.hasPrices()).toBe(false)
      expect(table.lookup('openrouterv1', 'deepseek/deepseek-v4.1-flash')).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})

describe('composePriceLookup', () => {
  const first: PriceLookup = (provider) => provider === 'a' ? {
    input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0,
  } : undefined
  const second: PriceLookup = (provider) => provider === 'b' ? {
    input: 3, output: 4, cacheRead: 1, cacheWrite: 0,
  } : undefined

  it('resolves from the first lookup that prices the route', () => {
    const composed = composePriceLookup(first, second)
    expect(composed('a', 'm')!.input).toBe(1)
    expect(composed('b', 'm')!.input).toBe(3)
    expect(composed('c', 'm')).toBeUndefined()
  })

  it('skips undefined lookups', () => {
    const composed = composePriceLookup(undefined, second)
    expect(composed('b', 'm')!.input).toBe(3)
    expect(composed('a', 'm')).toBeUndefined()
  })
})