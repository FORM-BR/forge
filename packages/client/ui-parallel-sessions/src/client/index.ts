/**
 * Parallel-session offer, browser half. It owns the `suggest_parallel_sessions` transcript line, the
 * card pinned above the transcript, and their dictionaries. The card reads only the logged call, so
 * a replayed session rebuilds the same offer; starting a task is the user's gesture here, never the
 * model's — this plugin creates the session, sends the offered prompt, and opens it in the main
 * region.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `uiWorkspace` Context merge and the service type.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { ParallelSessionsRow } from './ParallelSessionsRow.tsx'
import {
  ParallelSessionsAction, type ParallelSessionsActionInjected,
} from './ParallelSessionsAction.tsx'
import {
  createParallelOfferStore, type ParallelOffer, type ParallelStartMode, type ParallelTask,
} from './offer-store.ts'
import { en, NS, zh, type ParallelSessionsKey } from './locales.ts'

export type { ParallelOffer, ParallelStartMode, ParallelTask } from './offer-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The offered-sessions card copy. */
    parallelSessions: ParallelSessionsKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A session created from an offer, retained until its prompt is accepted. */
    parallelSessions: unknown
  }
}

/** Required services: the slot and locale registries, both Controllers, and workspace navigation. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'uiWorkspace']

/**
 * Register the dictionaries, the transcript line, and the header chip.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const offers = createParallelOfferStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-parallel-sessions: dictionaries')

  const startSession = async (
    sessionId: SessionId,
    task: ParallelTask,
    mode: ParallelStartMode,
  ): Promise<void> => {
    // The offer was made in this session's workspace, so its copy starts where the work is.
    let workspaceId = workspaces.list.getSnapshot().items
      .find(item => item.sessionIds.includes(sessionId))?.workspaceId
    if (mode === 'worktree') {
      const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
      if (cwd === undefined || cwd === '') throw new Error('the offering session has no working directory')
      const worktree = await workspaces.createWorktree({ cwd, title: task.title })
      // A worktree is its own checkout, so it becomes its own Workspace row: the
      // session can commit there without touching the offering session's tree.
      workspaceId = (await workspaces.create({ path: worktree.path })).workspaceId
    }
    const created = await sessions.create(workspaceId === undefined ? {} : { workspaceId })
    await sessions.using(created, { source: 'parallelSessions' }, async (reference) => {
      const binding = await reference.ready
      const result = await binding.session.prompt([{ type: 'text', text: task.prompt }], 'queue')
      if (!result.ok) throw new Error(`parallel session prompt rejected: ${result.error.message}`)
    })
    ctx.uiWorkspace.openSession(created)
  }

  // The call is the only place the offer exists, so the row that renders it publishes the tasks
  // and the pinned card reads them.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    {
      name: 'tool.call.toolview',
      key: 'suggest_parallel_sessions',
      locale: NS,
      inject: (sessionId: SessionId) => ({
        publishOffer: (offer: ParallelOffer) => { offers.publish(sessionId, offer) },
        clearOffer: () => { offers.clear(sessionId) },
      }),
    },
    ParallelSessionsRow,
  ))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: 'parallel-offer',
      // The offer follows the background-job chip in the same header band.
      order: 30,
      locale: NS,
      inject: (): ParallelSessionsActionInjected => ({
        hooks: { parallelOffer: offers.state },
        startSession,
        dismiss: (sessionId) => { offers.dismiss(sessionId) },
        settle: (sessionId, title) => { offers.settle(sessionId, title) },
      }),
    },
    ParallelSessionsAction,
  ))
}
