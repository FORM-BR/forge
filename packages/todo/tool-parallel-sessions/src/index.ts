/**
 * Model-facing offer to run independent work as parallel sessions. The call carries the whole
 * payload: the result echoes the accepted tasks, the session log keeps both sides, and the Web client
 * renders the card that starts each session. Registering the tool adds no session event of its own.
 * Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-parallel-sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-parallel-sessions'
export const inject = ['tools', 'systemPrompt']

/** One suggested session: the tab title, and the self-contained prompt that starts it. */
export interface ParallelTask {
  title: string
  prompt: string
}

/** Fewer than two independent tasks is a plan, not parallelism. */
const MIN_TASKS = 2

/** More than four suggestions stop being a split and become the plan itself. */
const MAX_TASKS = 4

const DESCRIPTION =
  'Offer to run independent work as parallel sessions. Call this when the remaining work has 2 to 4 '
  + 'tasks that do not depend on each other and can run at the same time in separate sessions. '
  + 'Call it as well when the user asks for new or parallel sessions in their own words, without naming '
  + 'this tool. '
  + 'Each task needs a short title and a prompt that stands on its own, without relying on the current '
  + 'conversation. The user decides which sessions to start, so propose only work you would start '
  + 'yourself.'

/**
 * Model-facing guidance registered as a system section, so offering parallel work
 * does not depend on the user naming the tool. The closing list mirrors how users
 * actually ask for it; the model needs those words to reach the tool.
 */
const GUIDANCE =
  'Work here can run in parallel sessions: separate conversations in the same workspace, each started from a '
  + 'prompt of its own and keeping its own transcript. When the remaining work splits into two or more parts '
  + 'that do not depend on each other, offer them with `suggest_parallel_sessions`; the user starts them, so the '
  + 'offer is the whole action and you start no session yourself. The user may call this parallel sessions, '
  + 'sessions side by side, a session chip, or splitting the work — treat those requests as this tool, and never '
  + 'ask the user for a tool name.'

/**
 * Validate the bounds the parameter schema cannot express and build the canonical
 * {@link ParallelTask}[]: two to four tasks, each with a trimmed non-empty title and prompt, and
 * distinct titles so the started sessions stay distinguishable.
 * @param raw - the model-supplied tasks, already schema-checked.
 * @returns the canonical task list.
 */
function toTaskList(raw: ParallelTask[]): ParallelTask[] {
  if (raw.length < MIN_TASKS) {
    throw new Error(`invalid tasks: at least ${MIN_TASKS} independent tasks are required (got ${raw.length})`)
  }
  if (raw.length > MAX_TASKS) {
    throw new Error(`invalid tasks: at most ${MAX_TASKS} tasks may be suggested (got ${raw.length})`)
  }
  const tasks: ParallelTask[] = []
  const titles = new Set<string>()
  for (const item of raw) {
    const title = item.title.trim()
    const prompt = item.prompt.trim()
    if (title.length === 0) {
      throw new Error('invalid task: `title` must be a non-empty string')
    }
    if (prompt.length === 0) {
      throw new Error(`invalid task: \`prompt\` must be a non-empty string (title ${JSON.stringify(title)})`)
    }
    if (titles.has(title)) {
      throw new Error(`invalid tasks: duplicate title ${JSON.stringify(title)}`)
    }
    titles.add(title)
    tasks.push({ title, prompt })
  }
  return tasks
}

/**
 * Register the `suggest_parallel_sessions` tool on `ctx.tools` and the guidance
 * that makes the offer reachable without the user naming it.
 * @param ctx - registrant context carrying the tool and prompt registries.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'parallel-sessions',
    order: ctx.systemPrompt.getSectionOrder('TOOL_PARALLEL_SESSIONS'),
    text: GUIDANCE,
  })
  ctx.tools.register(defineTool({
    name: 'suggest_parallel_sessions',
    description: DESCRIPTION,
    parameters: {
      tasks: {
        type: 'array',
        required: true,
        description: 'The independent tasks to offer, each one runnable on its own.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', required: true, description: 'Short name for the session, unique among the tasks.' },
            prompt: {
              type: 'string',
              required: true,
              description: 'The message that starts the session; self-contained and specific.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                prompt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Offered ${value.tasks.length} parallel sessions: ${value.tasks.map(task => task.title).join('; ')}.`,
      }],
    },
    execute(args) {
      const tasks = toTaskList(args.tasks)
      return Promise.resolve({ tasks: tasks.map(task => ({ title: task.title, prompt: task.prompt })) })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Suggest parallel sessions',
      kind: 'other',
      rawInput: args.tasks,
    }),
  }))
}
