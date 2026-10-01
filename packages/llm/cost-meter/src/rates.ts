/**
 * Client-safe cost math: route rates shape and the deterministic USD
 * derivation of one usage sample. No provider catalog is imported here, so
 * this module stays safe for the browser bundle.
 *
 * @module @deepseek-ai/dsh-cost-meter/rates
 */

/** USD per 1M tokens for one model route. */
export interface ModelCostRates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** Resolve a route's rates, or `undefined` when no price is known. */
export type PriceLookup = (provider: string, model: string) => ModelCostRates | undefined

const PER_MILLION = 1_000_000

/**
 * USD cost of one usage sample under one route's rates.
 * @param usage - provider-reported disjoint token buckets.
 * @param rates - USD per 1M tokens for the sample's route.
 * @returns total USD; buckets absent from the usage sample contribute 0.
 */
export function priceUsage(
  usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number },
  rates: ModelCostRates,
): number {
  return (
    usage.inputTokens * rates.input
    + (usage.cacheReadTokens ?? 0) * rates.cacheRead
    + (usage.cacheWriteTokens ?? 0) * rates.cacheWrite
    + usage.outputTokens * rates.output
  ) / PER_MILLION
}