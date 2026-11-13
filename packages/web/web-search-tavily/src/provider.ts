/**
 * `TavilySearchProvider`: a `WebSearchProvider` backed by the Tavily search API
 * (`POST /search` with extracted page content). It maps `content` to `snippet`,
 * `published_date` to `publishedAt`, drops entries without a URL, and maps the
 * optional generated `answer` to the result-level `content`. The key is
 * resolved per search — a literal key wins, then the credential plane — so a
 * key stored at runtime reaches the next search without re-registration.
 * @module @deepseek-ai/dsh-web-search-tavily/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { TavilyError, TavilyResult, TavilySearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default retrieval depth: `basic` costs one credit per search, `advanced` two. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Credential reference consulted when the config names none. */
export const TAVILY_DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Endpoint override, equivalent to the config's `baseURL`. */
export const TAVILY_BASE_URL_ENV = 'TAVILY_BASE_URL'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface TavilySearchProviderOptions {
  /** Literal Tavily API key; when non-empty it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Tavily API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv: CredentialRef
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Search depth sent as Tavily's `search_depth`. */
  searchDepth: 'basic' | 'advanced'
  /** Default result cap when a request carries no `maxResults`. */
  maxResults?: number
}

/**
 * Map one Tavily result to a normalized source, or `undefined` when it carries
 * no URL (the seam source's only mandatory field, so a URL-less entry is
 * dropped rather than emitted half-formed).
 *
 * @param result - one entry of Tavily's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no URL.
 */
export function mapTavilyResult(result: TavilyResult): WebSearchSource | undefined {
  if (result.url == null || result.url.length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0 ? { snippet: result.content } : {},
    ...result.published_date != null && result.published_date.length > 0
      ? { publishedAt: result.published_date }
      : {},
  }
}

/**
 * Map a Tavily response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /search` response body.
 * @returns the normalized result; URL-less entries are dropped
 *   ({@link mapTavilyResult}).
 * @throws {@link WebError} when `results` is present but not an array — a
 *   well-formed body of the wrong shape is a provider error, never a raw
 *   `TypeError`.
 */
export function mapTavilyResponse(response: TavilySearchResponse): WebSearchResult {
  if (response.results !== undefined && !Array.isArray(response.results)) {
    throw new WebError('Tavily returned a results field that is not an array', 'WEB_PROVIDER_ERROR')
  }
  const sources = (response.results ?? [])
    .map(mapTavilyResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  const answer = response.answer != null && response.answer.length > 0 ? response.answer : undefined
  // The web service owns the final `maxResults` truncation, so this provider
  // reports `truncated: false`.
  return {
    ...answer !== undefined ? { content: answer } : {},
    sources,
    truncated: false,
  }
}

/** The Tavily-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  constructor(private readonly options: TavilySearchProviderOptions) {}

  available(): boolean {
    return (hasLiteralKey(this.options) || this.options.resolveApiKey !== undefined)
      && URL.canParse(this.options.baseURL)
      && (this.options.maxResults === undefined || isPositiveInteger(this.options.maxResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = await this.resolveKey()
    if (apiKey === undefined) {
      throw new WebError(
        `Tavily search has no API key for "${this.options.apiKeyEnv}"; store it through the`
        + ' credentials service (the web Models page writes it), export it in the launching'
        + ' environment, or set a literal "apiKey" in the web-search-tavily config',
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    // A per-request bound wins over the configured default; either may be absent.
    const maxResults = request.maxResults ?? this.options.maxResults
    let response: Response
    try {
      response = await fetch(searchEndpoint(this.options.baseURL), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: this.options.searchDepth,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = await response.json() as TavilyError
        const detail = typeof parsed.detail === 'string'
          ? parsed.detail
          : parsed.detail?.error ?? parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message += `: ${detail}`
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as TavilySearchResponse
      return mapTavilyResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's API key: the literal config value wins, then the
   * credential resolver the plugin wired (credentials service, then the launch
   * environment).
   * @returns the resolved key, or `undefined` when no plane supplies one.
   */
  private async resolveKey(): Promise<string | undefined> {
    if (hasLiteralKey(this.options)) return this.options.apiKey
    return await this.options.resolveApiKey?.()
  }
}

/** True when the options carry a non-empty literal key. */
function hasLiteralKey(options: TavilySearchProviderOptions): boolean {
  return options.apiKey !== undefined && options.apiKey.length > 0
}

/** Join a base origin with the search path, tolerating a trailing slash. */
function searchEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/search`
}

/** True for a request limit that can be sent to Tavily (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
