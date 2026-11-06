/**
 * Tavily-backed search provider for the `ctx.web` seam.
 *
 * Written as a self-contained ESM module on purpose: it reads the credential
 * and environment planes straight off the Cordis context (`credentials`,
 * `launchEnvironment`) instead of importing the Host packages that expose
 * them, so it can be mounted by absolute path from a profile without a
 * workspace install or a `tsc`/`tsdown` pass. Promote it to an ordinary
 * `packages/web/web-search-*` package (see `../web-search-exa`) once the
 * provider itself has settled.
 *
 * Mount alongside `@deepseek-ai/dsh-web`, pin it with the seam's
 * `searchProvider: tavily`, and store the key as the `TAVILY_API_KEY`
 * credential.
 *
 * @module dsh-web-search-tavily
 */

/** Provider id the seam selects this backend by. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Tavily's public API origin; `/search` is appended. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** `basic` costs one credit per search, `advanced` costs two. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Result cap applied when neither the request nor the config names one. */
export const TAVILY_DEFAULT_MAX_RESULTS = 5

/** Credential reference consulted when the config names none. */
export const TAVILY_DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Endpoint override, equivalent to the config's `baseURL`. */
export const TAVILY_BASE_URL_ENV = 'TAVILY_BASE_URL'

/** The only two depths Tavily accepts. */
export const TAVILY_SEARCH_DEPTHS = Object.freeze(['basic', 'advanced'])

const USER_AGENT = 'dsh-forge/0.0.1'

/**
 * Typed search failure. Mirrors the seam's `WebError` (same `name` and `code`
 * fields) without importing the Host package, so a caller that matches on
 * `error.code` reads the same machine-routable value either way.
 */
export class TavilyWebError extends Error {
  /**
   * @param message - human-readable failure summary.
   * @param code - machine-routable code understood by the seam's consumers.
   * @param options - standard `Error` options, used to chain the cause.
   */
  constructor(message, code, options) {
    super(message, options)
    this.name = 'WebError'
    this.code = code
  }
}

/**
 * Whether a value is a search depth Tavily accepts.
 * @param value - candidate depth.
 * @returns true for `basic` or `advanced`.
 */
export function isTavilySearchDepth(value) {
  return typeof value === 'string' && TAVILY_SEARCH_DEPTHS.includes(value)
}

/**
 * Project one Tavily result onto a seam source. Only `url` is mandatory, so a
 * result without one is dropped rather than emitted half-formed.
 * @param result - one entry of Tavily's `results[]`.
 * @returns the seam source, or `undefined` when the entry carries no URL.
 */
export function mapTavilyResult(result) {
  const url = typeof result?.url === 'string' && result.url.length > 0 ? result.url : undefined
  if (url === undefined) return undefined
  const title = typeof result.title === 'string' && result.title.length > 0 ? result.title : undefined
  const snippet = typeof result.content === 'string' && result.content.length > 0 ? result.content : undefined
  const publishedAt = typeof result.published_date === 'string' && result.published_date.length > 0
    ? result.published_date
    : undefined
  return {
    url,
    ...title === undefined ? {} : { title },
    ...snippet === undefined ? {} : { snippet },
    ...publishedAt === undefined ? {} : { publishedAt },
  }
}

/**
 * Project a Tavily search response onto the seam's result. Tavily extracts
 * page content in the same call, so `content` becomes the `snippet`; its
 * optional generated `answer` becomes the result-level `content`. `truncated`
 * stays false because the seam owns the final `maxResults` cut.
 * @param response - parsed Tavily response body.
 * @returns the seam search result.
 */
export function mapTavilyResponse(response) {
  const results = Array.isArray(response?.results) ? response.results : []
  const sources = []
  for (const result of results) {
    const source = mapTavilyResult(result)
    if (source !== undefined) sources.push(source)
  }
  const answer = typeof response?.answer === 'string' && response.answer.length > 0 ? response.answer : undefined
  return { ...answer === undefined ? {} : { content: answer }, sources, truncated: false }
}

/**
 * Resolve one environment name the way the Host does: through the launcher's
 * snapshot when it exists, else the inherited process environment.
 * @param ctx - plugin context.
 * @param name - environment variable name.
 * @returns the value, or `undefined` when no layer supplies it.
 */
function readEnvironment(ctx, name) {
  const snapshot = ctx.get('launchEnvironment')
  if (snapshot !== undefined) return snapshot.get(name)?.value
  return process.env[name]
}

/** Join a base origin with the search path, tolerating a trailing slash. */
function searchEndpoint(baseURL) {
  return `${baseURL.replace(/\/+$/u, '')}/search`
}

/** Read whatever Tavily reported about a failed request, best effort. */
async function readFailureDetail(response) {
  try {
    const body = await response.json()
    const detail = body?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
    if (typeof detail?.error === 'string' && detail.error.length > 0) return detail.error
    if (typeof body?.error === 'string' && body.error.length > 0) return body.error
    if (typeof body?.message === 'string' && body.message.length > 0) return body.message
    return undefined
  } catch {
    return undefined
  }
}

/** Whether a rejection came from the caller's abort signal. */
function isAbort(error) {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * The Tavily search provider. `available()` is a purely local structural check
 * — it never reaches the network — so a missing key surfaces as a typed search
 * failure naming the credential reference instead of silently deselecting the
 * backend at selection time.
 */
export class TavilySearchProvider {
  /** Seam provider id. */
  get id() {
    return TAVILY_PROVIDER_ID
  }

  /**
   * @param options - resolved provider options.
   * @param options.baseURL - Tavily origin, without the `/search` path.
   * @param options.searchDepth - `basic` or `advanced`.
   * @param options.apiKeyEnv - credential reference consulted at search time.
   * @param options.resolveApiKey - async key resolver over the credential plane.
   * @param options.maxResults - result cap used when the request names none.
   * @param options.apiKey - literal key, used when the credential plane is empty.
   */
  constructor(options) {
    this.baseURL = options.baseURL
    this.searchDepth = options.searchDepth
    this.apiKeyEnv = options.apiKeyEnv
    this.resolveApiKey = options.resolveApiKey
    this.maxResults = options.maxResults
    this.apiKey = options.apiKey
  }

  /** Cheap local check: no network, no credential read. */
  available() {
    if (!URL.canParse(this.baseURL)) return false
    if (!isTavilySearchDepth(this.searchDepth)) return false
    if (this.maxResults !== undefined && !(Number.isInteger(this.maxResults) && this.maxResults > 0)) return false
    return true
  }

  /**
   * Resolve the key for one search: the literal config value wins, then the
   * credential plane, then the ambient environment.
   * @returns the key, or `undefined` when no plane supplies one.
   */
  async resolveKey() {
    if (typeof this.apiKey === 'string' && this.apiKey.length > 0) return this.apiKey
    const resolved = await this.resolveApiKey?.()
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined
  }

  /**
   * Run one search. `maxResults` is forwarded to Tavily as `max_results` (a
   * cost and latency saving); the seam still enforces the bound on the way back.
   * @param request - the seam's search request.
   * @param signal - caller's cancellation signal.
   * @returns the seam search result.
   */
  async search(request, signal) {
    const apiKey = await this.resolveKey()
    if (apiKey === undefined) {
      throw new TavilyWebError(
        `Tavily search has no API key for "${this.apiKeyEnv}"; store it through the credentials service or set the environment variable`,
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }
    const maxResults = request.maxResults ?? this.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS
    let response
    try {
      response = await fetch(searchEndpoint(this.baseURL), {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: this.searchDepth,
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
        }),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error) {
      if (isAbort(error)) {
        throw new TavilyWebError('Tavily search was aborted', 'WEB_ABORTED', { cause: error })
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new TavilyWebError(`Tavily search request failed: ${detail}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      const detail = await readFailureDetail(response)
      throw new TavilyWebError(
        `Tavily search failed with HTTP ${response.status}${detail === undefined ? '' : `: ${detail}`}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    let body
    try {
      body = await response.json()
    } catch (error) {
      throw new TavilyWebError('Tavily search returned a body that is not JSON', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    return mapTavilyResponse(body)
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Register the Tavily search provider with `ctx.web`. Defaults live here
 * rather than in a `Config` schema because this module ships without the
 * schemastery dependency; the loader passes the profile's config row through
 * unchanged.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the profile's config row for this plugin.
 */
export function apply(ctx, config = {}) {
  const apiKeyEnv = typeof config.apiKeyEnv === 'string' && config.apiKeyEnv.length > 0
    ? config.apiKeyEnv
    : TAVILY_DEFAULT_API_KEY_ENV
  const literalApiKey = typeof config.apiKey === 'string' && config.apiKey.length > 0 ? config.apiKey : undefined
  const configuredBaseURL = typeof config.baseURL === 'string' && config.baseURL.length > 0 ? config.baseURL : undefined
  const provider = new TavilySearchProvider({
    baseURL: configuredBaseURL ?? readEnvironment(ctx, TAVILY_BASE_URL_ENV) ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: isTavilySearchDepth(config.searchDepth) ? config.searchDepth : TAVILY_DEFAULT_SEARCH_DEPTH,
    apiKeyEnv,
    ...Number.isInteger(config.maxResults) && config.maxResults > 0 ? { maxResults: config.maxResults } : {},
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(apiKeyEnv)
        if (resolved !== undefined && resolved.value.length > 0) return resolved.value
      }
      return readEnvironment(ctx, apiKeyEnv)
    },
  })
  ctx.web.registerSearchProvider(provider)
}

// Deliberately NO `export default`. The cordis Loader resolves a plugin with
// `unwrapExports` = `exports.default ?? exports`, so a default export of the bare
// `apply` function would REPLACE this namespace and silently drop `inject` — the
// entry then fails activation with `cannot get property "web" without inject`.
// The named exports below are the plugin surface; keep them as the only ones.
// The named exports above (`name`, `inject`, `apply`) are the plugin surface.
