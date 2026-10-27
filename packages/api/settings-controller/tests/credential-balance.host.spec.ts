import { describe, expect, it, vi } from 'vitest'
import { fetchCredentialBalance, supportsBalance } from '../src/credential-balance.ts'

/** A fetch double answering one JSON body (or status) and recording the call. */
function answering(body: unknown, status = 200) {
  return vi.fn((..._args: Parameters<typeof fetch>) => Promise.resolve(Response.json(body, { status })))
}

describe('remaining balance behind one API key', () => {
  it('knows which provider routes have a balance endpoint', () => {
    expect(['openrouter', 'openrouterv1', 'deepseek'].map(supportsBalance)).toEqual([true, true, true])
    expect(['anthropic', 'openai'].map(supportsBalance)).toEqual([false, false])
  })

  it('answers unsupported for a route without an endpoint, before looking at the key', async () => {
    const fetchMock = answering({})
    expect(await fetchCredentialBalance('anthropic', 'sk-ant', fetchMock)).toEqual({ status: 'unsupported' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers unconfigured when no key resolves, including an empty one', async () => {
    const fetchMock = answering({})
    expect(await fetchCredentialBalance('openrouter', undefined, fetchMock)).toEqual({ status: 'unconfigured' })
    expect(await fetchCredentialBalance('deepseek', '', fetchMock)).toEqual({ status: 'unconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads OpenRouter credits minus usage from the fixed endpoint with the key as bearer', async () => {
    const fetchMock = answering({ data: { total_credits: 20, total_usage: 4.25 } })
    expect(await fetchCredentialBalance('openrouterv1', 'sk-or', fetchMock))
      .toEqual({ status: 'ok', amount: '15.75', currency: 'USD' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/credits')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or')
  })

  it('reports an OpenRouter body without numbers as an unexpected response', async () => {
    expect(await fetchCredentialBalance('openrouter', 'sk-or', answering({ data: {} })))
      .toEqual({ status: 'failed', detail: 'unexpected response' })
    expect(await fetchCredentialBalance('openrouter', 'sk-or', answering('nope')))
      .toEqual({ status: 'failed', detail: 'unexpected response' })
  })

  it('reads the first DeepSeek balance entry with its currency', async () => {
    const fetchMock = answering({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] })
    expect(await fetchCredentialBalance('deepseek', 'sk-ds', fetchMock))
      .toEqual({ status: 'ok', amount: '110.00', currency: 'CNY' })
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.deepseek.com/user/balance')
  })

  it('omits the currency when DeepSeek names none, and fails when no entry carries an amount', async () => {
    expect(await fetchCredentialBalance('deepseek', 'sk-ds', answering({ balance_infos: [{ total_balance: 3 }] })))
      .toEqual({ status: 'ok', amount: '3.00' })
    expect(await fetchCredentialBalance('deepseek', 'sk-ds', answering({ balance_infos: [] })))
      .toEqual({ status: 'failed', detail: 'unexpected response' })
    expect(await fetchCredentialBalance('deepseek', 'sk-ds', answering({})))
      .toEqual({ status: 'failed', detail: 'unexpected response' })
  })

  it('reports a refusal by status and a network failure by its message, never the key', async () => {
    expect(await fetchCredentialBalance('openrouter', 'sk-secret', answering({}, 401)))
      .toEqual({ status: 'failed', detail: 'HTTP 401' })
    const broken = vi.fn(() => Promise.reject(new Error('socket hang up')))
    expect(await fetchCredentialBalance('openrouter', 'sk-secret', broken))
      .toEqual({ status: 'failed', detail: 'socket hang up' })
    const literal = vi.fn(() => Promise.reject('boom'))
    expect(await fetchCredentialBalance('openrouter', 'sk-secret', literal))
      .toEqual({ status: 'failed', detail: 'request failed' })
  })

  it('defaults to the global fetch', async () => {
    const original = globalThis.fetch
    globalThis.fetch = answering({ data: { total_credits: 1, total_usage: 0 } }) as unknown as typeof fetch
    try {
      expect(await fetchCredentialBalance('openrouter', 'sk-or')).toMatchObject({ status: 'ok', amount: '1.00' })
    } finally {
      globalThis.fetch = original
    }
  })
})
