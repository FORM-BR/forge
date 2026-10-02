/**
 * Session Controller title refresh through the composed SessionTitleService. The
 * agent factory is a structural stub whose createAgent forwards seed/meta into
 * the real SessionStore, and whose resume never runs (every source here is
 * already attached). Cold-session resolution is the shared `agentFor` path —
 * remote-proxy-cold.spec.ts owns the resume evidence for every unary that rides
 * it, rename included.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionTitleService, { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

function request<P>(payload: P): P {
  return payload
}

async function composed(withTitles = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withTitles) {
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
  }
  // Store-backed structural factory: create builds the session with the
  // forwarded seed/meta (the store validates the balanced prefix) and
  // registers an idle agent stub over it.
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      await ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  return ctx
}

/** Register one live agent whose log holds `turns` completed turns. */
async function liveAgent(ctx: Context, id: string, turns: number): Promise<Session> {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

describe('sessions.refreshTitle', () => {
  it('materializes the fallback title and reports it as refreshed', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh-fallback', 1)

    const response = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value).toMatchObject({ status: 'refreshed', title: 'prompt 1' })
    expect(source.snapshotEvents().findLast(item => item.type === 'session/title')?.data.source).toEqual({ kind: 'fallback' })
  })

  it('runs the registered provider and regenerates an automatic title', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh-provider', 1)
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('test-provider'),
      automatic: 'first-prompt',
      generate: request => Promise.resolve({
        title: 'Titulo gerado',
        messageSeqs: request.messages.map(message => message.seq),
      }),
    })
    const response = await remote(ctx).refreshTitle(request({ sessionId: source.id, skipPinned: true }))
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.value).toMatchObject({ status: 'refreshed', title: 'Titulo gerado' })
  })

  it('skips a user-renamed session when skipPinned is set, and unpins it otherwise', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh-pinned', 1)
    ctx.sessionTitle.rename(source, 'my own name')

    const skipped = await remote(ctx).refreshTitle(request({ sessionId: source.id, skipPinned: true }))
    expect(skipped.ok).toBe(true)
    if (skipped.ok) expect(skipped.value).toEqual({ status: 'skipped-pinned' })
    expect(ctx.sessionTitle.get(source)?.title).toBe('my own name')

    const forced = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(forced.ok).toBe(true)
    if (forced.ok) expect(forced.value).toMatchObject({ status: 'refreshed', title: 'prompt 1' })
  })

  it('reports no-input for a session without eligible human text', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh-empty', 0)

    const response = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.value).toEqual({ status: 'no-input' })
  })

  it('maps a provider failure to internal with the provider message', async () => {
    const ctx = await composed()
    const source = await liveAgent(ctx, 'session-refresh-fail', 1)
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('failing-provider'),
      automatic: 'first-prompt',
      generate: () => Promise.reject(new Error('model offline')),
    })

    const response = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe('gateway/internal')
      expect(response.error.message).toMatch(/model offline/)
    }
  })

  it('answers internal when the composition mounts no session-title service', async () => {
    const ctx = await composed(false)
    const source = await liveAgent(ctx, 'session-refresh-no-titles', 1)

    const response = await remote(ctx).refreshTitle(request({ sessionId: source.id }))
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.message).toMatch(/mounts no session-title service/)
  })
})
