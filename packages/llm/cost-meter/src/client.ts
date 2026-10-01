/**
 * Client-namespace projection of cost-meter's browser-safe contracts and fold.
 *
 * @module @deepseek-ai/dsh-cost-meter/client
 */

export type * from './projection.ts'
export { foldCostUsage, initCostUsageState } from './cost-projection.ts'
export type { CostUsageState } from './cost-projection.ts'
// `priceUsage` stays importable from the client namespace: it is pure
// arithmetic plus a rates shape, with no host-only dependency.
export { priceUsage } from './rates.ts'
export type { ModelCostRates, PriceLookup } from './rates.ts'