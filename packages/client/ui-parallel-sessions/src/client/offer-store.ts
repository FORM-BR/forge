/**
 * Per-Session offer published by the transcript row and read by the card pinned above the
 * transcript. The offer lives in the logged call, not in the Session snapshot the notice chain
 * carries, so the row that renders the call is the one place that can hand it to the pinned seat.
 * One call owns one entry: a later call replaces it, and a settled or dismissed entry ignores
 * further publications of the same call.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One offered session: the title and the self-contained prompt that starts it. */
export interface ParallelTask {
  readonly title: string
  readonly prompt: string
}

/** The tasks one call offered. */
export interface ParallelOffer {
  /** The call that made the offer; also the entry's identity. */
  readonly callId: string
  /** Offered tasks in the model's order; empty once every task was started or the offer was dismissed. */
  readonly tasks: readonly ParallelTask[]
}

/** Where the offered session works: this workspace, or a checkout of its own. */
export type ParallelStartMode = 'local' | 'worktree'

/** Offers by Session; an unknown Session has none. */
export type ParallelOfferMap = ReadonlyMap<string, ParallelOffer>

/** Snapshot source the renderer binds as `useParallelOffer`. */
export interface ParallelOfferSource {
  getSnapshot(): ParallelOfferMap
  subscribe(listener: () => void): () => void
}

/** The offer store's read face and the writes its two surfaces perform. */
export interface ParallelOfferStore {
  readonly state: ParallelOfferSource
  /**
   * Publish the offer one call proposed; ignored once that call's entry exists.
   * @param sessionId - the Session whose transcript renders the call.
   * @param offer - the call identity and its tasks.
   */
  publish(sessionId: SessionId, offer: ParallelOffer): void
  /** Drop a Session's entry when its row unmounts. */
  clear(sessionId: SessionId): void
  /** Remove one started task, keeping the rest of the offer. */
  settle(sessionId: SessionId, title: string): void
  /** Hide the offer without starting anything. */
  dismiss(sessionId: SessionId): void
}

/** @returns the offer store shared by the row and the pinned card. */
export function createParallelOfferStore(): ParallelOfferStore {
  const store = createSnapshotStore<ParallelOfferMap>(new Map())

  const write = (sessionId: SessionId, next: ParallelOffer | undefined): void => {
    const current = store.getSnapshot()
    const entries = new Map(current)
    if (next === undefined) entries.delete(sessionId)
    else entries.set(sessionId, next)
    store.set(entries)
  }

  return {
    state: { getSnapshot: store.getSnapshot, subscribe: store.subscribe },
    publish: (sessionId, offer) => {
      const existing = store.getSnapshot().get(sessionId)
      // A settled or dismissed entry belongs to the same call: it must not come back.
      if (existing?.callId === offer.callId) return
      write(sessionId, offer)
    },
    clear: (sessionId) => { write(sessionId, undefined) },
    settle: (sessionId, title) => {
      const offer = store.getSnapshot().get(sessionId)
      if (offer === undefined) return
      write(sessionId, { callId: offer.callId, tasks: offer.tasks.filter(task => task.title !== title) })
    },
    dismiss: (sessionId) => {
      const offer = store.getSnapshot().get(sessionId)
      if (offer === undefined) return
      write(sessionId, { callId: offer.callId, tasks: [] })
    },
  }
}
