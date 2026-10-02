/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Prompt section name carrying the direct-mode policy while `directMode` is on. */
export const DIRECT_MODE_SECTION = 'agent-loop:direct-mode'

/**
 * Model-facing policy rendered as the {@link DIRECT_MODE_SECTION} section while
 * the `directMode` setting is on. It only advises the model: no loop limit,
 * tool catalog, or turn budget changes with it.
 */
export const DIRECT_MODE_POLICY = [
  'Direct mode is on. Work economically: answer directly and concisely, and keep your reasoning short when the task is simple.',
  'Use the fewest tool calls that get the job done: do not re-read, re-search, or re-verify what you already know, and do not explore beyond what the request needs.',
  'Do not spawn subagents or start workflows, background jobs, or other heavyweight tools for a trivial task.',
  'Ask one short question only when a missing detail truly blocks progress; otherwise make the reasonable assumption and say so.',
  'Reply in the language the user writes in.',
].join('\n')
