/**
 * Per-message branch and rewind: fork (or, for an empty cut, create a blank
 * sibling), restore the composer draft in the new Session, and for rewind
 * archive the source Session before opening the child.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageBranchRequest } from '../contract/slots.ts'

/**
 * Restore `text` into a Session's composer draft. The Session must already
 * be catalogued on the Host; this retains it only long enough for the write,
 * waiting for its binding to be ready first so the draft shell exists.
 * @param ctx - Client root context.
 * @param sessionId - target Session.
 * @param text - draft text; a no-op when empty.
 */
async function restoreDraft(ctx: Context, sessionId: SessionId, text: string): Promise<void> {
  if (text === '') return
  await ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async (reference) => {
    await reference.ready
    ctx.conversation.input.for(reference.binding.ctx).setDraft(text)
  }).catch(() => {
    // The child Session still opens; losing the restored draft leaves the
    // user able to retype instead of blocking navigation.
  })
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
  } catch {
    // Fork, create, or title failure leaves the source view unchanged.
    return
  }
  ctx.get('productAnalytics')?.track('branch_session_click', {
    session_id: childId,
    parent_session_id: sessionId,
    ...messageId === undefined ? {} : { parent_message_id: messageId },
    click_position: clickPosition,
    action: mode,
  })
  await restoreDraft(ctx, childId, draftText)
  if (mode === 'rewind') {
    try {
      await ctx.uiWorkspace.archiveSession(sessionId)
    } catch {
      // The child still opens; the source stays unarchived rather than lost.
    }
  }
  ctx.uiWorkspace.openSession(childId)
}
