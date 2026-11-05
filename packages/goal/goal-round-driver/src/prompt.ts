/** Model-visible continuation prompt for one same-session goal round. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GoalView } from '@deepseek-ai/dsh-goal'

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @param options - optional prompt variation.
 * @param options.reanchor - when true, prepend an objective re-anchor block that
 * ties the objective to the current workspace instructions and memory/feedback
 * anchors rather than continuing on earlier narration alone.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderGoalRoundPrompt(
  goal: GoalView,
  round: number,
  options?: { reanchor?: boolean },
): ContentBlock[] {
  const anchor = options?.reanchor === true
    ? '<goal_anchor>\n'
      + 'Re-anchor on the objective above and on the current workspace: re-read the relevant '
      + 'instruction files (AGENTS.md/CLAUDE.md) and any memory/feedback notes (MEMORY.md/'
      + 'FEEDBACK.md), and work from that fresh basis instead of earlier narration.\n'
      + '</goal_anchor>\n\n'
    : ''
  return [{
    type: 'text',
    text: anchor
      + '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. Before '
      + 'claiming completion, gather evidence that the whole objective is achieved, read the current '
      + 'goal, and mark it complete. If work remains, leave the goal active for the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
