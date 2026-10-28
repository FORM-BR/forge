/**
 * Resolve the exact fork/rewind cut point that precedes a given Chat Node,
 * from the already-materialized order index — never by rescanning the event window.
 */
import type { ChatSnapshot } from '../contract/snapshot.ts'
import type { MessageBranchPoint } from '../contract/slots.ts'

/**
 * The cut point immediately before one Chat Node's own key, in display order.
 * @param snapshot - current Chat snapshot.
 * @param nodeKey - stable key of the Node to cut before (a user or steering message).
 * @returns `{ kind: 'empty' }` when the Node is the first in the loaded order
 * (the Session's first message); otherwise the predecessor's `anchorSeq`.
 */
export function branchPointBefore(snapshot: ChatSnapshot, nodeKey: string): MessageBranchPoint {
  const index = snapshot.order.indexOf(nodeKey)
  if (index === -1) throw new Error(`ui-chat: node "${nodeKey}" is not in the current Chat order`)
  if (index === 0) return { kind: 'empty' }
  const predecessorKey = snapshot.order[index - 1]
  const predecessor = predecessorKey === undefined ? undefined : snapshot.nodes.get(predecessorKey)
  if (predecessor === undefined) {
    throw new Error(`ui-chat: predecessor of node "${nodeKey}" is missing from the Chat node store`)
  }
  return { kind: 'after', seq: predecessor.anchorSeq }
}
