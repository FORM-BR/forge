/**
 * Display masking for the editable view of an MCP server definition: what the
 * panel may show back to the user without letting a secret value ride the wire.
 *
 * @module @deepseek-ai/dsh-api-mcp-status/mask
 */

import type { McpArgView } from './types.ts'

/** Stand-in for every hidden value. */
export const MASK = '••••'

/** Option or variable names whose value is a credential. */
const SENSITIVE_NAME = /token|secret|passw|api[-_]?key|auth|credential|bearer|private[-_]?key|cookie|session/i

/** Well-known credential shapes that give themselves away without a telling flag. */
const SECRET_SHAPE = /^(?:sk-|gsk_|ghp_|gho_|ghs_|github_pat_|AIza|xox[abp]-|eyJ[\w-]{10,}\.)/

/** Path segments this long are treated as embedded credentials. */
const OPAQUE_SEGMENT_LENGTH = 20

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/** Result of masking one URL. */
export interface MaskedUrl {
  readonly text: string
  /** True when anything was replaced. */
  readonly masked: boolean
}

/**
 * Hide credentials, query values, and opaque path segments of a URL.
 * @param value - URL text from the configuration.
 * @returns the display text and whether any part was hidden.
 */
export function maskUrl(value: string): MaskedUrl {
  let url: URL
  try {
    url = new URL(value)
  } catch (_error) {
    return { text: MASK, masked: true }
  }
  let masked = false
  const userinfo = url.username !== '' || url.password !== ''
  if (userinfo) masked = true
  const path = url.pathname.split('/').map((segment) => {
    if (segment.length < OPAQUE_SEGMENT_LENGTH) return segment
    masked = true
    return MASK
  }).join('/')
  const keys = [...new Set(url.searchParams.keys())]
  if (keys.length > 0) masked = true
  const query = keys.length === 0 ? '' : `?${keys.map(key => `${key}=${MASK}`).join('&')}`
  return { text: `${url.protocol}//${userinfo ? `${MASK}@` : ''}${url.host}${path === '/' && keys.length === 0 ? '' : path}${query}`, masked }
}

/**
 * Mark the arguments that hold a secret: the value after a credential-named
 * option, the value of `NAME=value` with a credential name, credential-shaped
 * tokens, and URLs carrying credentials or query values.
 * @param args - literal argument texts in order.
 * @returns one view per argument, in order.
 */
export function maskArgs(args: readonly string[]): McpArgView[] {
  const views: McpArgView[] = []
  let hideNext = false
  for (const arg of args) {
    if (hideNext && !arg.startsWith('-')) {
      views.push({ text: MASK, masked: true })
      hideNext = false
      continue
    }
    hideNext = false
    const assigned = arg.indexOf('=')
    const name = assigned === -1 ? arg : arg.slice(0, assigned)
    const optionLike = arg.startsWith('-') || (assigned > 0 && /^[A-Za-z_][\w.-]*$/.test(name))
    if (optionLike && SENSITIVE_NAME.test(name)) {
      if (assigned === -1) {
        views.push({ text: arg, masked: false })
        hideNext = true
      } else {
        views.push({ text: `${name}=${MASK}`, masked: true })
      }
      continue
    }
    if (SECRET_SHAPE.test(arg)) {
      views.push({ text: MASK, masked: true })
    } else if (URL_SCHEME.test(arg)) {
      const url = maskUrl(arg)
      views.push({ text: url.text, masked: url.masked })
    } else {
      views.push({ text: arg, masked: false })
    }
  }
  return views
}

/**
 * Replace every given secret value in a message, longest first.
 * @param message - text that may quote submitted or stored values.
 * @param secrets - values to hide; short ones are ignored so common substrings survive.
 * @returns the message with each secret replaced by `***`.
 */
export function scrubSecrets(message: string, secrets: readonly string[]): string {
  let result = message
  for (const secret of [...secrets].filter(value => value.length >= 4).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('***')
  }
  return result
}
