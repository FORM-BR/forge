import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import { TavilySearchProvider, TAVILY_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-tavily'
import * as tavilyPlugin from '@deepseek-ai/dsh-web-search-tavily'
import { mapTavilyResponse, mapTavilyResult } from '../src/provider.ts'

const options = {
  apiKey: 'tvly-key',
  apiKeyEnv: credentialRef('TAVILY_API_KEY'),
  baseURL: 'https://api.tavily.test',
  searchDepth: 'basic' as const,
}

/** The provider options minus the literal key, for credential-plane cases. */
const withoutKey = { apiKeyEnv: options.apiKeyEnv, baseURL: options.baseURL, searchDepth: options.searchDepth }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Tavily result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapTavilyResult({
      url: 'https://a.test',
      title: 'A',
      content: 'first snippet',
      published_date: '2026-01-01',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'first snippet', publishedAt: '2026-01-01' })
  })

  it('drops a result with no URL', () => {
    expect(mapTavilyResult({ title: 'no url at all' })).toBeUndefined()
    expect(mapTavilyResult({ url: null, title: 'A' })).toBeUndefined()
    expect(mapTavilyResult({ url: '', title: 'A' })).toBeUndefined()
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapTavilyResult({ url: 'https://a.test', title: null, content: null, published_date: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapTavilyResult({ url: 'https://a.test', title: '', content: '', published_date: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps the generated answer to content when present', () => {
    expect(mapTavilyResponse({
      answer: 'Cua Driver drives the desktop.',
      results: [{ url: 'https://a.test', content: 'hi' }],
    })).toEqual({
      content: 'Cua Driver drives the desktop.',
      sources: [{ url: 'https://a.test', snippet: 'hi' }],
      truncated: false,
    })
  })

  it('omits content when the response carries no answer', () => {
    const result = mapTavilyResponse({ results: [{ url: 'https://a.test', content: 'hi' }] })
    expect(result.content).toBeUndefined()
    expect(result).toEqual({ sources: [{ url: 'https://a.test', snippet: 'hi' }], truncated: false })
  })

  it('tolerates a missing results array', () => {
    expect(mapTavilyResponse({}).sources).toEqual([])
    expect(mapTavilyResponse({ answer: 'only an answer' })).toEqual({
      content: 'only an answer',
      sources: [],
      truncated: false,
    })
  })

  it('throws WEB_PROVIDER_ERROR when results is present but not an array', () => {
    expect(() => mapTavilyResponse({ results: {} as never })).toThrow(
      expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }),
    )
  })
})

describe('TavilySearchProvider availability', () => {
  it('is unavailable without a key and without a resolver', () => {
    expect(new TavilySearchProvider(withoutKey).available()).toBe(false)
    expect(new TavilySearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a literal key', () => {
    expect(new TavilySearchProvider(options).available()).toBe(true)
  })

  it('is available with only a credential resolver', () => {
    expect(new TavilySearchProvider({ ...withoutKey, resolveApiKey: async () => undefined }).available())
      .toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new TavilySearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when maxResults is set but not a positive integer', () => {
    expect(new TavilySearchProvider({ ...options, maxResults: 0 }).available()).toBe(false)
    expect(new TavilySearchProvider({ ...options, maxResults: 1.5 }).available()).toBe(false)
  })
})

describe('TavilySearchProvider request mapping', () => {
  it('sends query, depth, include flags, max_results and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', content: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new TavilySearchProvider({ ...options, searchDepth: 'advanced' })
    await provider.search({ query: 'hello', maxResults: 5 })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.tavily.test/search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tvly-key')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'hello',
      search_depth: 'advanced',
      include_answer: true,
      include_raw_content: false,
      include_images: false,
      max_results: 5,
    })
  })

  it('tolerates a trailing slash on the base URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new TavilySearchProvider({ ...options, baseURL: 'https://api.tavily.test/' }).search({ query: 'q' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.tavily.test/search')
  })

  it('falls back to the configured maxResults when a request omits it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new TavilySearchProvider({ ...options, maxResults: 7 }).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 7 })
  })

  it('lets a request maxResults win over the configured default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new TavilySearchProvider({ ...options, maxResults: 7 }).search({ query: 'q', maxResults: 2 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 2 })
  })

  it('omits max_results when neither the request nor the config names one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new TavilySearchProvider(options).search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('max_results')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new TavilySearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('TavilySearchProvider missing credential', () => {
  it('fails with WEB_PROVIDER_CREDENTIAL_MISSING naming the reference', async () => {
    const provider = new TavilySearchProvider({
      ...withoutKey,
      resolveApiKey: async () => undefined,
    })
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
      message: expect.stringContaining('TAVILY_API_KEY'),
    }))
  })
})

describe('TavilySearchProvider error handling', () => {
  it('maps an HTTP error with a wrapped detail to the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: { error: 'Invalid API key' } }, { status: 401 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'Tavily API error (HTTP 401): Invalid API key',
      }))
  })

  it('maps an HTTP error with a string detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'rate limited' }, { status: 429 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Tavily API error (HTTP 429): rate limited' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Tavily API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Tavily API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: {} }, { status: 200 })))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new TavilySearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-search-tavily plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
    const fiber = await ctx.plugin(tavilyPlugin, { apiKey: 'tvly-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in tavilyPlugin).toBe(false)
  })

  it('threads searchDepth and maxResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
    const fiber = await ctx.plugin(tavilyPlugin, { apiKey: 'tvly-key', searchDepth: 'advanced', maxResults: 9 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ search_depth: 'advanced', max_results: 9 })
    await fiber.dispose()
  })

  it('falls back to $TAVILY_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.TAVILY_API_KEY
    process.env.TAVILY_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
      const fiber = await ctx.plugin(tavilyPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.tavily.com/search')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.TAVILY_API_KEY
      else process.env.TAVILY_API_KEY = prev
    }
  })

  it('is unavailable when neither config nor env supplies a key', async () => {
    const prev = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
      await ctx.plugin(tavilyPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
    } finally {
      if (prev !== undefined) process.env.TAVILY_API_KEY = prev
    }
  })

  it('resolves the credential for each search so a stored or rotated key needs no restart', async () => {
    const previous = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-tavily-credentials-'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      const fiber = await ctx.plugin(tavilyPlugin, {})

      await expect(ctx.web.search({ query: 'missing' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))

      const ref = credentialRef('TAVILY_API_KEY')
      await ctx.credentials.set(ref, 'stored-key')
      await ctx.web.search({ query: 'stored' })
      await ctx.credentials.set(ref, 'rotated-key')
      await ctx.web.search({ query: 'rotated' })

      const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
      expect(headers.map(value => value['authorization'])).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.TAVILY_API_KEY
      else process.env.TAVILY_API_KEY = previous
    }
  })

  it('falls back to the launch environment when the credential plane is empty', async () => {
    const prev = process.env.TAVILY_API_KEY
    process.env.TAVILY_API_KEY = 'env-key'
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-tavily-env-'))
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      const fiber = await ctx.plugin(tavilyPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (prev === undefined) delete process.env.TAVILY_API_KEY
      else process.env.TAVILY_API_KEY = prev
    }
  })
})
