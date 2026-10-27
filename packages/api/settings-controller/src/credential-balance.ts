/**
 * Remaining-balance lookup for one API key, run on the Host so the key never
 * reaches the browser. Only providers that publish a balance endpoint usable
 * with an ordinary key are asked; the endpoint is fixed per provider here and
 * never taken from configuration, so a profile's `baseURL` cannot redirect the
 * key to another host.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/credential-balance.ts
 */

import type { CredentialBalance } from '@deepseek-ai/dsh-credentials/types'

/** How long one provider may take before the lookup reports a failure. */
const BALANCE_TIMEOUT_MS = 8000

/** Provider route ids served by OpenRouter (`openrouterv1` is a personal profile's custom id). */
const OPENROUTER_ROUTES = new Set(['openrouter', 'openrouterv1'])

/** Provider route ids served by DeepSeek's own API. */
const DEEPSEEK_ROUTES = new Set(['deepseek'])

/** Whether {@link fetchCredentialBalance} has a balance endpoint for this provider route. */
export function supportsBalance(provider: string): boolean {
  return OPENROUTER_ROUTES.has(provider) || DEEPSEEK_ROUTES.has(provider)
}

/** Read an object-typed JSON member, or `undefined` for any other shape. */
function member(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** Format a finite number with two decimals, or `undefined`. */
function money(value: unknown): string | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : undefined
}

/** One GET to a fixed provider URL with the key as a bearer token. */
async function getJson(url: string, key: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json()
}

/**
 * Ask a provider how much credit is left behind one key.
 * @param provider - provider route id; routes without a public balance endpoint answer `unsupported`.
 * @param key - the secret, or `undefined` while the reference is unconfigured.
 * @param fetchImpl - HTTP client, injectable for tests.
 * @returns the outcome; never throws and never echoes the key.
 */
export async function fetchCredentialBalance(
  provider: string,
  key: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CredentialBalance> {
  if (!supportsBalance(provider)) return { status: 'unsupported' }
  if (key === undefined || key.length === 0) return { status: 'unconfigured' }
  try {
    if (OPENROUTER_ROUTES.has(provider)) {
      // `total_credits` and `total_usage` are USD; the remainder is what is left to spend.
      const body = await getJson('https://openrouter.ai/api/v1/credits', key, fetchImpl)
      const total = Number(member(member(body, 'data'), 'total_credits'))
      const used = Number(member(member(body, 'data'), 'total_usage'))
      if (!Number.isFinite(total) || !Number.isFinite(used)) return { status: 'failed', detail: 'unexpected response' }
      return { status: 'ok', amount: (total - used).toFixed(2), currency: 'USD' }
    }
    const body = await getJson('https://api.deepseek.com/user/balance', key, fetchImpl)
    const infos = member(body, 'balance_infos')
    const first = Array.isArray(infos) ? infos[0] as unknown : undefined
    const amount = money(member(first, 'total_balance'))
    const currency = member(first, 'currency')
    if (amount === undefined) return { status: 'failed', detail: 'unexpected response' }
    return typeof currency === 'string' ? { status: 'ok', amount, currency } : { status: 'ok', amount }
  } catch (error: unknown) {
    // The message comes from our own Error/HTTP status or fetch's own failure; the key is never in it.
    return { status: 'failed', detail: error instanceof Error ? error.message : 'request failed' }
  }
}
