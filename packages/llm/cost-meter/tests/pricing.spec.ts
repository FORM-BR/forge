import { describe, expect, it } from 'vitest'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { catalogPriceLookup } from '@deepseek-ai/dsh-cost-meter/src/pricing.ts'
import type { PriceLookup } from '@deepseek-ai/dsh-cost-meter/client'
import { priceUsage } from '@deepseek-ai/dsh-cost-meter/client'

const RATES = { input: 0.8, output: 1.6, cacheRead: 0.2, cacheWrite: 0 }

describe('priceUsage', () => {
  it('prices disjoint buckets at USD per 1M tokens', () => {
    expect(priceUsage(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      RATES,
    )).toBeCloseTo(0.8 + 0.8, 10)
  })

  it('charges absent cache buckets as zero', () => {
    expect(priceUsage({ inputTokens: 1000, outputTokens: 0 }, RATES)).toBeCloseTo(0.0008, 10)
  })

  it('includes reported cache buckets', () => {
    expect(priceUsage(
      { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 500_000, cacheWriteTokens: 100_000 },
      RATES,
    )).toBeCloseTo(0.0008 + 0.0016 + 0.1 + 0, 10)
  })
})

describe('catalogPriceLookup', () => {
  const price: PriceLookup = catalogPriceLookup()

  it('resolves a priced OpenRouter catalog model with positive rates', () => {
    // Robust against catalog drift: any priced OpenRouter model round-trips.
    const catalog = getBuiltinModels('openrouter') as Array<{
      id: string
      cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
    }>
    const priced = catalog.find(model => model.cost !== undefined && model.cost.input > 0)
    expect(priced).toBeDefined()
    const rates = price('openrouter', priced!.id)
    expect(rates).toBeDefined()
    expect(rates!.input).toBeGreaterThan(0)
  })

  it('is undefined for models the catalog does not price', () => {
    expect(price('openrouter', 'vendor/not-in-catalog')).toBeUndefined()
  })

  it('is undefined for providers the catalog does not ship', () => {
    expect(price('no-such-provider', 'anything')).toBeUndefined()
  })
})