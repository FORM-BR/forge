import { describe, expect, it } from 'vitest'
import type { StartedToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import { gitCommand } from '../src/client/tool/models/git-command.ts'
import { shellCommand } from '../src/client/tool/models/terminal-card-model.ts'

const shell = (args: Record<string, unknown>): StartedToolCall => ({
  phase: 'start', callId: 'c1', name: 'bash',
  argsRaw: JSON.stringify({ description: 'Run a command', ...args }),
  turn: 1, step: 1, time: 1_000, subCalls: [],
})

describe('gitCommand', () => {
  it('names the action of a plain Git subcommand', () => {
    expect(gitCommand('git status')).toEqual({ tool: 'git', action: 'status' })
    expect(gitCommand('git commit -m "fix: x"')).toEqual({ tool: 'git', action: 'commit' })
    expect(gitCommand('git checkout -b feat/x')).toEqual({ tool: 'git', action: 'checkout' })
  })

  it('reads a subcommand chained behind another command', () => {
    expect(gitCommand('cd packages/app && git push origin master')).toEqual({ tool: 'git', action: 'push' })
    expect(gitCommand('git fetch\n git merge origin/main')).toEqual({ tool: 'git', action: 'pull' })
  })

  it('prefers the first recognized stage, so staging followed by a commit reads as the commit', () => {
    expect(gitCommand('git add -A && git commit -m x')).toEqual({ tool: 'git', action: 'commit' })
  })

  it('skips options, option values, environment assignments, and wrapper programs', () => {
    expect(gitCommand('git -C packages/app log --oneline -5')).toEqual({ tool: 'git', action: 'log' })
    expect(gitCommand('GIT_PAGER=cat sudo /usr/bin/git show HEAD')).toEqual({ tool: 'git', action: 'diff' })
    expect(gitCommand('git --no-pager diff')).toEqual({ tool: 'git', action: 'diff' })
  })

  it('maps GitHub CLI subcommands', () => {
    expect(gitCommand('gh pr create --fill')).toEqual({ tool: 'gh', action: 'pull-request' })
    expect(gitCommand('gh run list --limit 5')).toEqual({ tool: 'gh', action: 'run' })
    expect(gitCommand('gh issue list')).toEqual({ tool: 'gh', action: 'issue' })
    expect(gitCommand('gh release create v1.0.0')).toEqual({ tool: 'gh', action: 'release' })
  })

  it('leaves commands without an icon', () => {
    expect(gitCommand('npm run build')).toBeNull()
    expect(gitCommand('echo git status')).toBeNull()
    expect(gitCommand('git')).toBeNull()
    expect(gitCommand('gh')).toBeNull()
    expect(gitCommand('git config user.name')).toBeNull()
    expect(gitCommand('sudo')).toBeNull()
    expect(gitCommand('   ')).toBeNull()
  })
})

describe('shellCommand', () => {
  it('reads the command text of a shell call', () => {
    expect(shellCommand(shell({ command: 'git status' }))).toBe('git status')
  })

  it('leaves a call without a valid shell command undefined', () => {
    expect(shellCommand(shell({ command: '   ' }))).toBeUndefined()
    expect(shellCommand({ ...shell({ command: 'ls' }), argsRaw: 'not json' })).toBeUndefined()
    expect(shellCommand({ ...shell({ command: 'ls' }), name: 'read_file' })).toBeUndefined()
  })
})
