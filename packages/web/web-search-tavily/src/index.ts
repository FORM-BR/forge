/**
 * Tavily-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-tavily
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  TavilySearchProvider,
  TAVILY_BASE_URL_ENV,
  TAVILY_DEFAULT_API_KEY_ENV,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
} from './provider.ts'

export {
  TAVILY_BASE_URL_ENV,
  TAVILY_DEFAULT_API_KEY_ENV,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_PROVIDER_ID,
  TavilySearchProvider,
} from './provider.ts'
export type { TavilySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Tavily API key; prefer `apiKeyEnv` so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `TAVILY_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval depth sent as Tavily's `search_depth`: `basic` or `advanced`. */
  searchDepth?: 'basic' | 'advanced'
  /** Default result cap when a request carries no `maxResults`. Omitted = none. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
  searchDepth: z.union(['basic', 'advanced'] as const),
  maxResults: z.number().step(1).min(1),
})

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? TAVILY_DEFAULT_API_KEY_ENV)
  const environment = launchEnvironmentOf(ctx)
  const shared = {
    baseURL: config.baseURL ?? environment.get(TAVILY_BASE_URL_ENV)?.value ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    apiKeyEnv,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
  }
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    // Without the credentials seam the environment is the whole credential
    // plane, so an absent key is conclusive here: the provider reports
    // unavailable and the seam rejects selection, rather than every search
    // failing at dispatch.
    ctx.web.registerSearchProvider(new TavilySearchProvider({
      ...shared,
      apiKey: literalApiKey ?? environment.get(apiKeyEnv)?.value ?? '',
    }))
    return
  }
  // With the seam the key is resolved per search: a key stored at runtime (the
  // web Models page writes it) reaches the next search without re-registering
  // the provider. The launch environment stays the fallback layer.
  ctx.web.registerSearchProvider(new TavilySearchProvider({
    ...shared,
    ...literalApiKey !== undefined ? { apiKey: literalApiKey } : {},
    resolveApiKey: async () => {
      const resolved = await credentials.resolve(apiKeyEnv)
      if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      return environment.get(apiKeyEnv)?.value
    },
  }))
}
