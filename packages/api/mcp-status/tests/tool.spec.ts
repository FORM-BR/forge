import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpStatusService from '../src/index.ts'
import { apply, inject } from '../src/tool.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

interface Registered {
  readonly name: string
  readonly parameters: object
  execute: (args: object, exec: object) => Promise<string>
}

async function harness(withService: boolean): Promise<Registered> {
  const ctx = new Context()
  contexts.push(ctx)
  const registered: Registered[] = []
  ctx.provide('tools', { register: (definition: Registered) => { registered.push(definition); return () => undefined } } as never)
  if (withService) await ctx.plugin(McpStatusService)
  else ctx.provide('mcpServerStatus', { register: () => () => undefined } as never)
  apply(ctx)
  const tool = registered[0]
  if (tool === undefined) throw new Error('the tool was not registered')
  return tool
}

describe('mcp_servers tool', () => {
  it('requires the tools and status services', () => {
    expect(inject).toEqual(['tools', 'mcpServerStatus'])
  })

  it('registers one read-only tool with no parameters', async () => {
    const tool = await harness(true)
    expect(tool.name).toBe('mcp_servers')
    expect(tool.parameters).toMatchObject({ properties: {} })
  })

  it('answers the same snapshot the panel reads, as JSON', async () => {
    const tool = await harness(true)
    const text = await tool.execute({}, {})
    expect(JSON.parse(text)).toEqual({ servers: [], management: { writable: false, readOnlyReason: 'no-profile' } })
  })

  it('explains itself when the registry cannot report', async () => {
    const tool = await harness(false)
    await expect(tool.execute({}, {})).rejects.toThrow(/not available/)
  })
})
