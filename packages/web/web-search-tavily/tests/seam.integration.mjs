/**
 * Integration check against the REAL `ctx.web` seam (not a stub).
 *
 * Mounts `WebRuntime` from the built worktree lib exactly the way
 * `packages/web/web/tests/web.spec.ts` does, registers this plugin through the
 * cordis loader path, and asserts that a configured `searchProvider: 'tavily'`
 * actually RESOLVES to this provider — i.e. the failure is the provider's own
 * typed missing-credential error, never the seam's
 * `WEB_PROVIDER_CONFIGURED_MISSING` / `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 *
 * This is the check that the config swap in the profile really took effect;
 * `--dump-config` only proves composition, and a stubbed context cannot prove
 * provider selection at all.
 */
import assert from 'node:assert/strict'
import { Context } from '../../../../vendor/cordis/lib/index.js'
import WebRuntime from '../../web/lib/index.js'
import { apply, inject, name } from '../index.mjs'

const ctx = new Context()
await ctx.plugin(WebRuntime, { searchProvider: 'tavily', fetchProvider: 'http' })
await ctx.plugin({ name, inject, apply }, {})

let caught
try {
  await ctx.web.search({ query: 'teste de integracao do seam' })
} catch (error) {
  caught = error
}

assert.ok(caught, 'uma busca sem credencial deveria falhar, nao responder vazio')
console.log('code    :', caught.code)
console.log('message :', caught.message)

assert.notEqual(
  caught.code,
  'WEB_PROVIDER_CONFIGURED_MISSING',
  'o id tavily nao estava registrado no seam',
)
assert.notEqual(
  caught.code,
  'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
  'o provider tavily foi resolvido mas se declarou indisponivel',
)
assert.equal(caught.code, 'WEB_PROVIDER_UNAVAILABLE')
assert.match(caught.message, /TAVILY_API_KEY/)

console.log('ok  o seam resolve searchProvider=tavily para este provider')
console.log('ok  sem credencial, o erro tipado nomeia TAVILY_API_KEY')
