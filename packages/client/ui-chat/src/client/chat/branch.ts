/**
 * Per-message branch and rewind: fork (or, for an empty cut, create a blank
 * sibling), restore the composer draft in the new Session, and for rewind
 * archive the source Session before opening the child.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageBranchRequest } from '../contract/slots.ts'

/**
 * Restore `text` into a Session's draft while it stays retained. The retained
 * reference must outlive this write and release only after `openSession` has
 * taken its own hold — releasing to zero references between the two tears
 * the Session generation (and its draft shell) down immediately.
 * @param ctx - Client root context.
 * @param sessionId - target Session.
 * @param text - draft text; a no-op when empty.
 */
async function restoreDraft(ctx: Context, sessionId: SessionId): Promise<(text: string) => void> {
  const reference = ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
  await reference.ready.catch(() => {
    // Falls through: a failed open still releases below and opens the child
    // through the normal navigation path, which reports its own failure.
  })
  return (text) => {
    if (text !== '') {
      try {
        ctx.conversation.input.for(reference.binding.ctx).setDraft(text)
      } catch {
        // The child Session still opens; losing the restored draft leaves
        // the user able to retype instead of blocking navigation.
      }
    }
    reference.release()
  }
}

/**
 * Execute one per-message branch or rewind request.
 * @param ctx - Client root context.
 * @param sessionId - source Session.
 * @param request - exact cut point, mode, restored draft text, and analytics identity.
 */
export async function performBranch(ctx: Context, sessionId: SessionId, request: MessageBranchRequest): Promise<void> {
  const { point, mode, draftText, messageId, clickPosition } = request
  let childId: SessionId
  try {
    if (point.kind === 'empty') {
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      childId = await ctx.sessions.create(cwd === undefined ? {} : { cwd })
    } else {
      childId = await ctx.sessions.fork({
        sessionId,
        atSeq: point.seq,
        increaseTitle: mode === 'branch',
      })
    }
  } catch (error) {
    // The source view stays unchanged, and the failure is reported rather
    // than silent: a swallowed rejection made a refused cut look like a
    // dead button.
    console.warn('ui-chat: per-message branch/rewind failed:', error)
    return
  }
  ctx.get('productAnalytics')?.track('branch_session_click', {
    session_id: childId,
    parent_session_id: sessionId,
    ...messageId === undefined ? {} : { parent_message_id: messageId },
    click_position: clickPosition,
    action: mode,
  })
  const releaseChild = await restoreDraft(ctx, childId)
  if (mode === 'rewind') {
    try {
      await ctx.uiWorkspace.archiveSession(sessionId)
    } catch {
      // The child still opens; the source stays unarchived rather than lost.
    }
  }
  ctx.uiWorkspace.openSession(childId)
  releaseChild(draftText)
}
