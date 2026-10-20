/** Git and GitHub subcommand that a shell row shows as its leading icon. */
export type GitAction =
  | 'commit'
  | 'branch'
  | 'merge'
  | 'pull-request'
  | 'push'
  | 'pull'
  | 'checkout'
  | 'status'
  | 'diff'
  | 'log'
  | 'stash'
  | 'tag'
  | 'clone'
  | 'run'
  | 'issue'
  | 'release'

/** A shell row's Git command and the glyph its subcommand earns. */
export interface GitCommand {
  tool: 'git' | 'gh'
  action: GitAction
}

const GIT_ACTIONS: Readonly<Record<string, GitAction>> = {
  commit: 'commit',
  branch: 'branch',
  switch: 'checkout',
  checkout: 'checkout',
  restore: 'checkout',
  reset: 'checkout',
  revert: 'checkout',
  merge: 'merge',
  rebase: 'merge',
  'cherry-pick': 'merge',
  push: 'push',
  pull: 'pull',
  fetch: 'pull',
  status: 'status',
  diff: 'diff',
  show: 'diff',
  blame: 'diff',
  log: 'log',
  shortlog: 'log',
  reflog: 'log',
  stash: 'stash',
  tag: 'tag',
  clone: 'clone',
  worktree: 'branch',
}

const GH_ACTIONS: Readonly<Record<string, GitAction>> = {
  pr: 'pull-request',
  issue: 'issue',
  run: 'run',
  workflow: 'run',
  release: 'release',
}

/** Git options whose value is a separate token, so the subcommand is not the option's argument. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** Command prefixes that may stand before the real program. */
const PREFIX_PROGRAMS = new Set(['sudo', 'command', 'time', 'nohup', 'exec'])

/** Leading environment assignment such as `GIT_PAGER=cat`. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Split a shell line into simple commands, dropping pipelines and chained stages. */
function simpleCommands(command: string): string[] {
  return command.split(/[;&|\n]+/).map(segment => segment.trim()).filter(segment => segment !== '')
}

/** Drop leading environment assignments and wrapper programs. */
function stripPrefixes(tokens: readonly string[]): string[] {
  const start = tokens.findIndex(token => !PREFIX_PROGRAMS.has(token) && !ENV_ASSIGNMENT.test(token))
  return start < 0 ? [] : tokens.slice(start)
}

/**
 * Read the Git or GitHub program and its subcommand from one simple command.
 * @param tokens - whitespace-separated words of one command.
 * @returns the program and subcommand, or null when the command runs something else.
 */
function programCommand(tokens: readonly string[]): { tool: 'git' | 'gh'; subcommand: string } | null {
  const words = stripPrefixes(tokens)
  const program = words[0]
  if (program === undefined) return null
  const base = program.split(/[\\/]/).at(-1)
  const tool = base === 'git' ? 'git' : base === 'gh' ? 'gh' : null
  if (tool === null) return null
  let skipValue = false
  for (const word of words.slice(1)) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (tool === 'git' && GIT_OPTIONS_WITH_VALUE.has(word)) {
      skipValue = true
      continue
    }
    if (word.startsWith('-')) continue
    return { tool, subcommand: word }
  }
  return null
}

/**
 * Identify the Git action a shell command performs, for the row's leading icon.
 * @param command - full shell command text of a bash or PowerShell call.
 * @returns the first recognized Git or GitHub subcommand across chained commands, or null.
 */
export function gitCommand(command: string): GitCommand | null {
  for (const segment of simpleCommands(command)) {
    const parsed = programCommand(segment.split(/\s+/))
    if (parsed === null) continue
    const action = (parsed.tool === 'git' ? GIT_ACTIONS : GH_ACTIONS)[parsed.subcommand]
    if (action !== undefined) return { tool: parsed.tool, action }
  }
  return null
}
