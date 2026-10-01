/**
 * Catalog pricing: model cost rates resolved from the installed pi-ai catalog.
 * Host-only — imports the provider catalog, so it never reaches the browser.
 *
 * @module @deepseek-ai/dsh-cost-meter/pricing
 */

import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import type { ModelCostRates, PriceLookup } from './rates.ts'

/**
 * Builtin-provider lookup over the installed pi-ai catalog. Models without a
 * `cost` block are treated as unpriced; providers pi-ai does not ship resolve
 * to no rates at all. Provider catalogs are memoized per process.
 */
export function catalogPriceLookup(): PriceLookup {
  const byProvider = new Map<string, Map<string, ModelCostRates>>()
  const catalogIdOf = (provider: string): string =>
    // The personal profile's `openrouterv1` provider id aliases the pi-ai
    // builtin `openrouter` catalog, which carries cost data for its models.
    provider === 'openrouterv1' ? 'openrouter' : provider
  return (provider, model) => {
    let models = byProvider.get(provider)
    if (models === undefined) {
      const found = new Map<string, ModelCostRates>()
      try {
        for (const entry of getBuiltinModels(catalogIdOf(provider) as BuiltinProvider)) {
          const cost = entry.cost
          if (cost === undefined) continue
          found.set(entry.id, {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cacheRead,
            cacheWrite: cost.cacheWrite,
          })
        }
      } catch {
        // Unknown provider: the catalog resolves no rates for it.
      }
      byProvider.set(provider, found)
      models = found
    }
    // Try the exact stored id first (the catalog keeps OpenRouter "latest"
    // aliases with a `~` prefix), then the alias-free id.
    return models.get(model) ?? (model.startsWith('~') ? models.get(model.slice(1)) : undefined)
  }
}