import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import * as RemotesClient from '../src/client/index.ts'

const contexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...contexts].map(async (ctx) => { await ctx.fiber.dispose() }))
  contexts.clear()
})

/** Namespaces the client assembly mounts onto a capturing `remote.$mount`. */
async function mountedNamespaces(): Promise<Set<string>> {
  const ctx = new Context()
  contexts.add(ctx)
  const namespaces = new Set<string>()
  ctx.reflect.provide('remote', {
    $mount: async (contribution: { readonly descriptors: readonly { readonly namespace: string }[] }) => {
      for (const { namespace } of contribution.descriptors) namespaces.add(namespace)
      return async () => {}
    },
  })
  await RemotesClient.apply(ctx)
  return namespaces
}

it('mounts the cost namespaces that the Costs client plugins require as services', async () => {
  const namespaces = await mountedNamespaces()
  expect(namespaces).toContain('costs')
  expect(namespaces).toContain('costReport')
})
