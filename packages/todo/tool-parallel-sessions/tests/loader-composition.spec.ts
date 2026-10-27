// Proves the tool works through the real Loader: the package boots from a
// cordis.yml, announces its schema, and accepts or rejects calls end to end.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolParallelSessions from '@deepseek-ai/dsh-tool-parallel-sessions'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a cordis.yml carrying the tool runtime and this package.
 * @returns the booted context.
 */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-parallel-sessions-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-parallel-sessions'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-parallel-sessions', ToolParallelSessions],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const TASKS = [
  { title: 'Waitlist copy', prompt: 'Rewrite the waitlist page copy to name the launch date.' },
  { title: 'Pricing table', prompt: 'Compare the three plans and list the missing rows in the pricing table.' },
]

describe('tool-parallel-sessions through cordis.yml', () => {
  it('announces the tool and returns the offered tasks', async () => {
    const ctx = await boot()
    const schema = ctx.tools.schemas().find(row => row.name === 'suggest_parallel_sessions')
    expect(schema?.description).toContain('2 to 4 tasks that do not depend on each other')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('offer'),
      name: 'suggest_parallel_sessions',
      arguments: { tasks: TASKS },
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ tasks: TASKS })
    expect(resultText(result)).toBe('Offered 2 parallel sessions: Waitlist copy; Pricing table.')
  }, 30_000)

  it.each([
    { label: 'a single task', tasks: [TASKS[0]], failure: 'at least 2 independent tasks are required (got 1)' },
    {
      label: 'five tasks',
      tasks: [...TASKS, { title: 'a', prompt: 'a' }, { title: 'b', prompt: 'b' }, { title: 'c', prompt: 'c' }],
      failure: 'at most 4 tasks may be suggested (got 5)',
    },
    { label: 'a blank prompt', tasks: [TASKS[0], { title: 'Empty', prompt: '   ' }], failure: '`prompt` must be a non-empty string (title "Empty")' },
    { label: 'repeated titles', tasks: [TASKS[0], { title: 'Waitlist copy', prompt: 'Other work.' }], failure: 'duplicate title "Waitlist copy"' },
  ])('rejects $label', async ({ tasks, failure }) => {
    const ctx = await boot()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('invalid'),
      name: 'suggest_parallel_sessions',
      arguments: { tasks },
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain(failure)
  }, 30_000)
})
