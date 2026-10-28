/** Cut-point resolution over the materialized Chat order, without event-window scans. */
import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import { branchPointBefore, rewindNeedsConfirmation } from '../src/client/chat/branch-point.ts'

function node(key: string, anchorSeq: number): ChatConversationViewNode {
  return {
    key,
    kind: 'turn-tail',
    id: key,
    target: 'chat',
    anchorSeq,
    location: { kind: 'session' },
    visibility: 'visible',
  } as ChatConversationViewNode
}

function snapshotOf(nodes: readonly ChatConversationViewNode[], turnOrder: readonly number[] = []): ChatSnapshot {
  return {
    order: nodes.map(candidate => candidate.key),
    nodes: { get: (key: string) => nodes.find(candidate => candidate.key === key) },
    timeline: { turnOrder, turns: new Map() },
  } as unknown as ChatSnapshot
}

describe('branchPointBefore', () => {
  it('reports the empty cut for the first message in the loaded order', () => {
    expect(branchPointBefore(snapshotOf([node('user:1', 1)]), 'user:1')).toEqual({ kind: 'empty' })
  })

  it('rounds a fractional predecessor anchor down to its durable event seq', () => {
    // Chat parks a turn-tail at turn/end + 0.1; the Host only accepts the
    // integer event seq, so the cut must land on turn/end itself.
    const chat = snapshotOf([node('turn:1:tail', 8.1), node('user:9', 9)])
    expect(branchPointBefore(chat, 'user:9')).toEqual({ kind: 'after', seq: 8 })
  })

  it('keeps an already-integer predecessor seq unchanged', () => {
    const chat = snapshotOf([node('user:1', 1), node('user:5', 5)])
    expect(branchPointBefore(chat, 'user:5')).toEqual({ kind: 'after', seq: 1 })
  })

  it('fails loud for a Node that is not in the current order', () => {
    expect(() => branchPointBefore(snapshotOf([node('user:1', 1)]), 'user:99'))
      .toThrow('is not in the current Chat order')
  })

  it('fails loud when the predecessor is missing from the node store', () => {
    const chat = {
      order: ['ghost', 'user:9'],
      nodes: { get: () => undefined },
      timeline: { turnOrder: [], turns: new Map() },
    } as unknown as ChatSnapshot
    expect(() => branchPointBefore(chat, 'user:9')).toThrow('predecessor of node "user:9" is missing')
  })
})

describe('rewindNeedsConfirmation', () => {
  it('asks only when more than one Turn follows the cut point', () => {
    expect(rewindNeedsConfirmation(snapshotOf([], [1, 2]), 1)).toBe(false)
    expect(rewindNeedsConfirmation(snapshotOf([], [1, 2, 3]), 1)).toBe(true)
    expect(rewindNeedsConfirmation(snapshotOf([], [1]), 1)).toBe(false)
  })

  it('asks when the Turn is outside the loaded timeline and several Turns are loaded', () => {
    expect(rewindNeedsConfirmation(snapshotOf([], [1, 2]), 7)).toBe(true)
    expect(rewindNeedsConfirmation(snapshotOf([], [1]), 7)).toBe(false)
  })
})
