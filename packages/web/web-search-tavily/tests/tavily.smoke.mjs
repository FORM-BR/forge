/**
 * Local smoke test for the Tavily provider. Runs without a Tavily account:
 * the network is replaced by a stub, so the mapping, the credential-plane
 * resolution and the typed failures are all exercised offline.
 *
 * Run: node tests/tavily.smoke.mjs
 */
import assert from 'node:assert/strict'

import {
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_MAX_RESULTS,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TavilySearchProvider,
  TavilyWebError,
  apply,
  mapTavilyResponse,
  name as pluginName,
} from '../index.mjs'

let passed = 0
// Sequential on purpose: the async checks swap `globalThis.fetch`, so running
// them concurrently would let one check observe another's stub.
const check = async (label, fn) => {
  await fn()
  passed += 1
  console.log(`ok  ${label}`)
}

/** Build a context stub that records what the plugin registers. */
function makeContext({ launchEnvironment, credentials } = {}) {
  const registered = []
  return {
    registered,
    get(key) {
      if (key === 'launchEnvironment') return launchEnvironment
      if (key === 'credentials') return credentials
      return undefined
    },
    web: {
      registerSearchProvider(provider) {
        registered.push(provider)
        return () => {}
      },
    },
  }
}

/** Run `fn` with a stubbed global fetch, then restore it. */
async function withFetch(implementation, fn) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

const canned = {
  query: 'dsh computer use',
  answer: 'Cua Driver drives the desktop.',
  results: [
    {
      url: 'https://example.com/a',
      title: 'A',
      content: 'first snippet',
      score: 0.9,
      published_date: '2026-05-01',
    },
    {
      url: 'https://example.com/b',
      title: '',
      content: '',
    },
    { title: 'no url at all' },
  ],
}

await check('plugin exports the loader contract', () => {
  assert.equal(pluginName, 'web-search-tavily')
})

await check('exposes the plugin surface as named exports, with no default', async () => {
  const mod = await import('../index.mjs')
  // A `default` export would win the Loader's `exports.default ?? exports` and
  // drop `inject`, which fails activation at runtime.
  assert.equal(mod.default, undefined)
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['web'])
})

await check('maps results onto seam sources, dropping the URL-less one', () => {
  const result = mapTavilyResponse(canned)
  assert.equal(result.truncated, false)
  assert.equal(result.content, 'Cua Driver drives the desktop.')
  assert.equal(result.sources.length, 2)
  assert.deepEqual(result.sources[0], {
    url: 'https://example.com/a',
    title: 'A',
    snippet: 'first snippet',
    publishedAt: '2026-05-01',
  })
  // Empty strings are omissions, not values, and `publishedAt` stays absent.
  assert.deepEqual(result.sources[1], { url: 'https://example.com/b' })
})

await check('survives a response with no results and no answer', () => {
  assert.deepEqual(mapTavilyResponse({}), { sources: [], truncated: false })
  assert.deepEqual(mapTavilyResponse(undefined), { sources: [], truncated: false })
})

await check('available() rejects a malformed base URL or depth', () => {
  const base = { apiKeyEnv: 'TAVILY_API_KEY', resolveApiKey: async () => undefined }
  const good = new TavilySearchProvider({ ...base, baseURL: TAVILY_DEFAULT_BASE_URL, searchDepth: 'basic' })
  assert.equal(good.available(), true)
  assert.equal(good.id, 'tavily')
  const badURL = new TavilySearchProvider({ ...base, baseURL: 'not a url', searchDepth: 'basic' })
  assert.equal(badURL.available(), false)
  const badDepth = new TavilySearchProvider({ ...base, baseURL: TAVILY_DEFAULT_BASE_URL, searchDepth: 'deep' })
  assert.equal(badDepth.available(), false)
  const badCount = new TavilySearchProvider({
    ...base, baseURL: TAVILY_DEFAULT_BASE_URL, searchDepth: 'basic', maxResults: 0,
  })
  assert.equal(badCount.available(), false)
})

await check('search() posts the expected request and maps the reply', async () => {
  const provider = new TavilySearchProvider({
    baseURL: `${TAVILY_DEFAULT_BASE_URL}/`,
    searchDepth: 'advanced',
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => 'tvly-test-key',
  })
  let seen
  const result = await withFetch(
    async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify(canned), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    () => provider.search({ query: 'dsh computer use', maxResults: 3 }),
  )
  assert.equal(seen.url, `${TAVILY_DEFAULT_BASE_URL}/search`)
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.redirect, 'error')
  assert.equal(seen.init.headers.authorization, 'Bearer tvly-test-key')
  const body = JSON.parse(seen.init.body)
  assert.deepEqual(body, {
    query: 'dsh computer use',
    search_depth: 'advanced',
    max_results: 3,
    include_answer: true,
    include_raw_content: false,
    include_images: false,
  })
  assert.equal(result.sources.length, 2)
})

await check('search() falls back to the configured result cap', async () => {
  const provider = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: TAVILY_DEFAULT_SEARCH_DEPTH,
    apiKeyEnv: 'TAVILY_API_KEY',
    maxResults: 7,
    resolveApiKey: async () => 'tvly-test-key',
  })
  let body
  await withFetch(
    async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{"results":[]}', { status: 200 })
    },
    () => provider.search({ query: 'q' }),
  )
  assert.equal(body.max_results, 7)
  const bare = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: TAVILY_DEFAULT_SEARCH_DEPTH,
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => 'tvly-test-key',
  })
  await withFetch(
    async (_url, init) => {
      body = JSON.parse(init.body)
      return new Response('{"results":[]}', { status: 200 })
    },
    () => bare.search({ query: 'q' }),
  )
  assert.equal(body.max_results, TAVILY_DEFAULT_MAX_RESULTS)
})

await check('a missing key fails with WEB_PROVIDER_UNAVAILABLE naming the ref', async () => {
  const provider = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: 'basic',
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => undefined,
  })
  await assert.rejects(
    () => provider.search({ query: 'q' }),
    (error) => {
      assert.ok(error instanceof TavilyWebError)
      assert.equal(error.code, 'WEB_PROVIDER_UNAVAILABLE')
      assert.match(error.message, /TAVILY_API_KEY/u)
      return true
    },
  )
})

await check('an HTTP failure surfaces the status and Tavily detail', async () => {
  const provider = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: 'basic',
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => 'tvly-bad',
  })
  await withFetch(
    async () => new Response(JSON.stringify({ detail: { error: 'Invalid API key' } }), { status: 401 }),
    () => assert.rejects(
      () => provider.search({ query: 'q' }),
      (error) => {
        assert.equal(error.code, 'WEB_PROVIDER_ERROR')
        assert.match(error.message, /HTTP 401: Invalid API key/u)
        return true
      },
    ),
  )
})

await check('an aborted request fails with WEB_ABORTED', async () => {
  const provider = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: 'basic',
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => 'tvly-test-key',
  })
  await withFetch(
    async () => {
      throw new DOMException('This operation was aborted', 'AbortError')
    },
    () => assert.rejects(
      () => provider.search({ query: 'q' }),
      (error) => {
        assert.equal(error.code, 'WEB_ABORTED')
        return true
      },
    ),
  )
})

await check('a transport failure chains its cause as WEB_PROVIDER_ERROR', async () => {
  const provider = new TavilySearchProvider({
    baseURL: TAVILY_DEFAULT_BASE_URL,
    searchDepth: 'basic',
    apiKeyEnv: 'TAVILY_API_KEY',
    resolveApiKey: async () => 'tvly-test-key',
  })
  await withFetch(
    async () => {
      throw new TypeError('fetch failed')
    },
    () => assert.rejects(
      () => provider.search({ query: 'q' }),
      (error) => {
        assert.equal(error.code, 'WEB_PROVIDER_ERROR')
        assert.match(error.message, /fetch failed/u)
        return true
      },
    ),
  )
})

await check('apply() resolves the key through the credential plane first', async () => {
  const seen = []
  const ctx = makeContext({
    launchEnvironment: { get: (n) => (n === 'TAVILY_API_KEY' ? { value: 'from-env' } : undefined) },
    credentials: {
      async resolve(ref) {
        seen.push(ref)
        return { value: 'from-credentials' }
      },
    },
  })
  apply(ctx, {})
  assert.equal(ctx.registered.length, 1)
  const provider = ctx.registered[0]
  assert.equal(await provider.resolveKey(), 'from-credentials')
  assert.deepEqual(seen, ['TAVILY_API_KEY'])
})

await check('apply() falls back to the launch environment, then to nothing', async () => {
  const envCtx = makeContext({
    launchEnvironment: { get: (n) => (n === 'TAVILY_API_KEY' ? { value: 'from-env' } : undefined) },
    credentials: { async resolve() { return undefined } },
  })
  apply(envCtx, {})
  assert.equal(await envCtx.registered[0].resolveKey(), 'from-env')

  const emptyCtx = makeContext({ credentials: { async resolve() { return undefined } } })
  apply(emptyCtx, {})
  assert.equal(await emptyCtx.registered[0].resolveKey(), undefined)
})

await check('apply() honours config overrides and defaults', async () => {
  const defaulted = makeContext()
  apply(defaulted, {})
  const provider = defaulted.registered[0]
  assert.equal(provider.baseURL, TAVILY_DEFAULT_BASE_URL)
  assert.equal(provider.searchDepth, TAVILY_DEFAULT_SEARCH_DEPTH)
  assert.equal(provider.apiKeyEnv, 'TAVILY_API_KEY')
  assert.equal(provider.available(), true)

  const overridden = makeContext()
  apply(overridden, {
    apiKey: 'tvly-literal',
    apiKeyEnv: 'OTHER_KEY',
    baseURL: 'http://127.0.0.1:9999',
    searchDepth: 'advanced',
    maxResults: 2,
  })
  const custom = overridden.registered[0]
  assert.equal(custom.baseURL, 'http://127.0.0.1:9999')
  assert.equal(custom.searchDepth, 'advanced')
  assert.equal(custom.apiKeyEnv, 'OTHER_KEY')
  assert.equal(await custom.resolveKey(), 'tvly-literal')
})

await check('apply() reads the base URL override from the environment', () => {
  const ctx = makeContext({
    launchEnvironment: { get: (n) => (n === 'TAVILY_BASE_URL' ? { value: 'https://proxy.local' } : undefined) },
  })
  apply(ctx, {})
  assert.equal(ctx.registered[0].baseURL, 'https://proxy.local')
})

console.log(`\n${passed} checks passed`)
