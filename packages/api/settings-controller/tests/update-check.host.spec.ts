/** Boot check, interval polling, version comparison, ETag caching, and failure degradation of the GitHub release update check. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  UpdateCheckController,
  fetchGitHubLatestRelease,
  isNewerVersion,
  type Config,
  type GitHubLatestReleaseCheck,
  type GitHubLatestReleaseFetcher,
} from '../src/update-check.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })

const config: Config = { repository: 'FORM-BR/forge', intervalHours: 6, enabled: true }

/** Scripted fetcher: returns one answer per call, in order; repeats the last answer once exhausted. */
function scripted(...answers: readonly GitHubLatestReleaseCheck[]): GitHubLatestReleaseFetcher & { calls: number } {
  let index = 0
  const fetchLatest = (async () => {
    const answer = answers[Math.min(index, answers.length - 1)]
    index++
    fetchLatest.calls = index
    return answer
  }) as GitHubLatestReleaseFetcher & { calls: number }
  fetchLatest.calls = 0
  return fetchLatest
}

function boot(fetchLatest: GitHubLatestReleaseFetcher, overrides: Partial<Config> = {}, currentVersion = () => '1.0.0') {
  const ctx = new Context()
  roots.push(ctx)
  const controller = new UpdateCheckController(ctx, { ...config, ...overrides }, { fetchLatest, currentVersion })
  return { ctx, controller }
}

describe('isNewerVersion', () => {
  it('compares dotted numeric versions, ignoring an optional leading v and any -suffix', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', 'v1.0.1')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-forge.1')).toBe(false)
    expect(isNewerVersion('0.3.0-forge.1', '0.3.1')).toBe(true)
    expect(isNewerVersion('1.0', '1.0.1')).toBe(true)
  })

  it('never reports newer for an unparseable version on either side', () => {
    expect(isNewerVersion('1.0.0', 'not-a-version')).toBe(false)
    expect(isNewerVersion('not-a-version', '2.0.0')).toBe(false)
  })
})

describe('the updateCheck Remote namespace', () => {
  it('publishes its own namespace with a single status method', async () => {
    const { controller } = boot(scripted({ kind: 'unavailable' }))
    expect(controller.typertRemote.namespace).toBe('updateCheck')
    expect(remoteMethods(controller)).toEqual([{ method: 'status', invocation: { kind: 'direct' } }])
  })

  it('reports disabled when no repository is configured', () => {
    const { controller } = boot(scripted({ kind: 'unavailable' }), { repository: undefined })
    expect(controller.status()).toEqual({ enabled: false })
  })

  it('reports disabled when the user preference turns checking off, even with a repository configured', () => {
    const { controller } = boot(scripted({ kind: 'unavailable' }), { enabled: false })
    expect(controller.status()).toEqual({ enabled: false })
  })

  it('reports a newer version with its release page URL when the latest tag is ahead', async () => {
    const fetchLatest = scripted({ kind: 'release', release: { tagName: 'v1.2.0', htmlUrl: 'https://github.com/FORM-BR/forge/releases/tag/v1.2.0', etag: '"abc"' } })
    const { controller } = boot(fetchLatest)
    await vi.waitFor(() => { expect(fetchLatest.calls).toBe(1) })
    expect(controller.status()).toEqual({
      enabled: true, checking: false, current: '1.0.0', failed: false,
      newerVersion: '1.2.0', releaseUrl: 'https://github.com/FORM-BR/forge/releases/tag/v1.2.0',
    })
  })

  it('reports no newer version when the latest tag matches the running build', async () => {
    const fetchLatest = scripted({ kind: 'release', release: { tagName: 'v1.0.0', htmlUrl: 'https://example.com', etag: undefined } })
    const { controller } = boot(fetchLatest)
    await vi.waitFor(() => { expect(fetchLatest.calls).toBe(1) })
    expect(controller.status()).toEqual({ enabled: true, checking: false, current: '1.0.0', failed: false })
  })

  it('replays the stored ETag as If-None-Match on the next check and keeps the previous release across a 304', async () => {
    const fetchLatest = vi.fn<GitHubLatestReleaseFetcher>()
      .mockResolvedValueOnce({ kind: 'release', release: { tagName: 'v1.2.0', htmlUrl: 'https://example.com', etag: '"etag-1"' } })
      .mockResolvedValueOnce({ kind: 'not-modified' })
    const ctx = new Context()
    roots.push(ctx)
    const controller = new UpdateCheckController(ctx, { ...config, intervalHours: 1 }, { fetchLatest, currentVersion: () => '1.0.0' })
    await vi.waitFor(() => { expect(fetchLatest).toHaveBeenCalledTimes(1) })
    expect(fetchLatest).toHaveBeenNthCalledWith(1, 'FORM-BR', 'forge', undefined, expect.any(AbortSignal))
    const afterFirst = controller.status()
    expect(afterFirst).toMatchObject({ newerVersion: '1.2.0' })
    // Force a second check directly, the way the interval timer would later.
    await (controller as unknown as { checkNow: () => Promise<void> }).checkNow()
    expect(fetchLatest).toHaveBeenNthCalledWith(2, 'FORM-BR', 'forge', '"etag-1"', expect.any(AbortSignal))
    expect(controller.status()).toEqual(afterFirst)
  })

  it('degrades to a failed, silent state on a network error without throwing', async () => {
    const fetchLatest = scripted({ kind: 'unavailable' })
    const { controller } = boot(fetchLatest)
    await vi.waitFor(() => { expect(fetchLatest.calls).toBe(1) })
    expect(controller.status()).toEqual({ enabled: true, checking: false, current: '1.0.0', failed: true })
  })

  it('treats a thrown fetcher rejection (e.g. rate limit) the same as an unavailable answer', async () => {
    const fetchLatest = vi.fn<GitHubLatestReleaseFetcher>().mockRejectedValue(new Error('rate limited'))
    const ctx = new Context()
    roots.push(ctx)
    const controller = new UpdateCheckController(ctx, config, { fetchLatest, currentVersion: () => '1.0.0' })
    await vi.waitFor(() => { expect(fetchLatest).toHaveBeenCalledTimes(1) })
    expect(controller.status()).toEqual({ enabled: true, checking: false, current: '1.0.0', failed: true })
  })

  it('keeps the previously known release across a later failed check', async () => {
    const fetchLatest = vi.fn<GitHubLatestReleaseFetcher>()
      .mockResolvedValueOnce({ kind: 'release', release: { tagName: 'v1.2.0', htmlUrl: 'https://example.com', etag: undefined } })
      .mockResolvedValueOnce({ kind: 'unavailable' })
    const ctx = new Context()
    roots.push(ctx)
    const controller = new UpdateCheckController(ctx, config, { fetchLatest, currentVersion: () => '1.0.0' })
    await vi.waitFor(() => { expect(fetchLatest).toHaveBeenCalledTimes(1) })
    expect(controller.status()).toMatchObject({ newerVersion: '1.2.0', failed: false })
    await (controller as unknown as { checkNow: () => Promise<void> }).checkNow()
    expect(controller.status()).toEqual({
      enabled: true, checking: false, current: '1.0.0', failed: false,
      newerVersion: '1.2.0', releaseUrl: 'https://example.com',
    })
  })

  it('reports checking until the boot check settles', () => {
    const { controller } = boot(scripted({ kind: 'unavailable' }))
    expect(controller.status()).toEqual({ enabled: true, checking: true, current: '1.0.0', failed: false })
  })

  it('never polls when disposed before the boot check runs', async () => {
    const fetchLatest = scripted({ kind: 'unavailable' })
    const ctx = new Context()
    const controller = new UpdateCheckController(ctx, config, { fetchLatest, currentVersion: () => '1.0.0' })
    void controller
    await ctx.fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 10))
    // The interval cleared by disposal cannot fire again even if the boot check was already in flight.
    expect(fetchLatest.calls).toBeLessThanOrEqual(1)
  })
})

describe('fetchGitHubLatestRelease', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends the User-Agent and Accept headers, and If-None-Match only when an ETag is supplied', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.2.0', html_url: 'https://example.com' }), {
      status: 200, headers: { etag: '"xyz"' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    const result = await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, signal)
    expect(result).toEqual({ kind: 'release', release: { tagName: 'v1.2.0', htmlUrl: 'https://example.com', etag: '"xyz"' } })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/FORM-BR/forge/releases/latest')
    const headers = init.headers as Record<string, string>
    expect(headers['user-agent']).toBe('FORGE')
    expect(headers['accept']).toBe('application/vnd.github+json')
    expect(headers['if-none-match']).toBeUndefined()

    await fetchGitHubLatestRelease('FORM-BR', 'forge', '"prev-etag"', signal)
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect((secondInit.headers as Record<string, string>)['if-none-match']).toBe('"prev-etag"')
  })

  it('reports not-modified on HTTP 304 without reading a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 304 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', '"etag"', new AbortController().signal)).toEqual({ kind: 'not-modified' })
  })

  it('reports unavailable on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('reports unavailable when fetch itself throws (network error, DNS failure, abort)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('reports unavailable when the response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('reports unavailable when the JSON body is missing tag_name or html_url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 42, html_url: 'https://example.com' }), { status: 200 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    expect(await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)).toEqual({ kind: 'unavailable' })
  })

  it('treats a response with no ETag header as an undefined etag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.0.0', html_url: 'https://example.com' }), { status: 200 })))
    const result = await fetchGitHubLatestRelease('FORM-BR', 'forge', undefined, new AbortController().signal)
    expect(result).toEqual({ kind: 'release', release: { tagName: 'v1.0.0', htmlUrl: 'https://example.com', etag: undefined } })
  })
})

describe('edge cases for full coverage', () => {
  it('uses the real fetcher and environment version resolver when no test options are supplied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v2.3.4', html_url: 'https://example.com' }), { status: 200 })))
    const ctx = new Context()
    roots.push(ctx)
    const previous = process.env['DSH_CLIENT_VERSION']
    process.env['DSH_CLIENT_VERSION'] = '2.3.4'
    try {
      const controller = new UpdateCheckController(ctx, { repository: 'FORM-BR/forge', intervalHours: 6, enabled: true })
      await vi.waitFor(() => { expect(controller.status()).toMatchObject({ current: '2.3.4' }) })
    } finally {
      if (previous === undefined) delete process.env['DSH_CLIENT_VERSION']
      else process.env['DSH_CLIENT_VERSION'] = previous
      vi.unstubAllGlobals()
    }
  })

  it('falls back to version 0.0.0 when DSH_CLIENT_VERSION is unset and no test resolver is supplied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.0.0', html_url: 'https://example.com' }), { status: 200 })))
    const ctx = new Context()
    roots.push(ctx)
    const previous = process.env['DSH_CLIENT_VERSION']
    delete process.env['DSH_CLIENT_VERSION']
    try {
      const controller = new UpdateCheckController(ctx, { repository: 'FORM-BR/forge', intervalHours: 6, enabled: true })
      await vi.waitFor(() => { expect(controller.status()).toMatchObject({ current: '0.0.0' }) })
    } finally {
      if (previous !== undefined) process.env['DSH_CLIENT_VERSION'] = previous
      vi.unstubAllGlobals()
    }
  })

  it('schedules a real interval that fires a second check after intervalHours', async () => {
    vi.useFakeTimers()
    const fetchLatest = scripted({ kind: 'unavailable' })
    const ctx = new Context()
    roots.push(ctx)
    try {
      new UpdateCheckController(ctx, { repository: 'FORM-BR/forge', intervalHours: 1, enabled: true }, { fetchLatest, currentVersion: () => '1.0.0' })
      await vi.waitFor(() => { expect(fetchLatest.calls).toBe(1) }, { timeout: 1000 })
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(fetchLatest.calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a real fetch timeout abort the request after GITHUB_REQUEST_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const fetchLatest = vi.fn<GitHubLatestReleaseFetcher>((_owner, _repo, _etag, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const ctx = new Context()
    roots.push(ctx)
    try {
      const controller = new UpdateCheckController(ctx, { repository: 'FORM-BR/forge', intervalHours: 6, enabled: true }, { fetchLatest, currentVersion: () => '1.0.0' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(controller.status()).toMatchObject({ failed: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('compares versions of differing segment counts in both directions', () => {
    expect(isNewerVersion('1.0.1', '1.0')).toBe(false)
    expect(isNewerVersion('1.0', '1.1')).toBe(true)
  })

  it('does nothing when checkNow runs against a malformed repository (no slash)', async () => {
    const fetchLatest = scripted({ kind: 'unavailable' })
    const ctx = new Context()
    roots.push(ctx)
    const controller = new UpdateCheckController(ctx, { repository: 'onlyowner', intervalHours: 6, enabled: true }, { fetchLatest, currentVersion: () => '1.0.0' })
    await (controller as unknown as { checkNow: () => Promise<void> }).checkNow()
    expect(fetchLatest.calls).toBe(0)
  })

  it('does nothing when checkNow runs with repository cleared to undefined', async () => {
    const fetchLatest = scripted({ kind: 'unavailable' })
    const ctx = new Context()
    roots.push(ctx)
    const controller = new UpdateCheckController(ctx, { repository: undefined, intervalHours: 6, enabled: true }, { fetchLatest, currentVersion: () => '1.0.0' })
    await (controller as unknown as { checkNow: () => Promise<void> }).checkNow()
    expect(fetchLatest.calls).toBe(0)
  })
})
