/** The `agent-loop` settings section layered over the composition entry. */

import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import AgentLoop, { DIRECT_MODE_POLICY, DIRECT_MODE_SECTION } from '@deepseek-ai/dsh-agent-loop'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

async function boot() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, AgentLoop, { agents: [], maxParallelToolCalls: 4 })
  return { ctx, live }

}

it('updates future scheduler budgets while preserving composed agents and the running loop', async () => {
  const { ctx, live } = await boot()
  const before = live.fiber
  await live.update({ maxParallelToolCalls: 1 })
  expect(live.entry.fiber === before).toBe(true)
  expect(ctx.agentLoop.config.maxParallelToolCalls.get()).toBe(1)
  expect(ctx.agentLoop.config.agents).toEqual([])
  await expect(live.update({ maxParallelToolCalls: 0 })).rejects.toThrow()
  expect(ctx.agentLoop.config.maxParallelToolCalls.get()).toBe(1)
})

it('adds the direct-mode policy to the system prompt only while directMode is on', async () => {
  const { ctx, live } = await boot()
  const policy = async () => (await ctx.systemPrompt.assemble()).sections.find(section => section.name === DIRECT_MODE_SECTION)
  // Off by default: the section exists but renders nothing, so the prompt is unchanged.
  expect(ctx.agentLoop.config.directMode.get()).toBe(false)
  expect((await policy())?.text).toBe('')
  expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(DIRECT_MODE_POLICY)

  const before = live.fiber
  await live.update({ directMode: true })
  expect(live.entry.fiber === before).toBe(true)
  expect(ctx.agentLoop.config.directMode.get()).toBe(true)
  expect((await policy())?.text).toBe(DIRECT_MODE_POLICY)
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Reply in the language the user writes in.')

  await live.update({ directMode: false })
  expect((await policy())?.text).toBe('')
  expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain(DIRECT_MODE_POLICY)
})
