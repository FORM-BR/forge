/** Agent Map model: delegation tree, live state, activity and cost folds. */
import { describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-cost-meter/client'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import type {
  SessionProjectionMap, SessionProjectionSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  buildAgentMap, readTeamRoster, resolveRootId, unloadedBranches,
} from '../src/client/agent-map/model.ts'

const sid = (id: string): SessionId => id as SessionId

type Values = Readonly<Partial<SessionProjectionMap>>

function snapshot(values: Values, state: SessionProjectionSnapshot['state'] = 'ready'): SessionProjectionSnapshot {
  return { values, state, error: null }
}

function entry(
  id: string,
  mode: 'one-shot' | 'continuable' | 'unknown',
  label?: string,
): SessionProjectionMap['subagentCatalog'][number] {
  return mode === 'continuable'
    ? { id: sid(id), createdAt: 1, mode, label: label ?? id }
    : { id: sid(id), createdAt: 1, mode, ...label === undefined ? {} : { label } }
}

function row(id: string, partial: Partial<SessionSummary> = {}): SessionSummary {
  return { id: sid(id), displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 0, ...partial }
}

function cost(totalCostUsd: number, unpricedAttempts = 0): SessionProjectionMap['costUsage'] {
  return { totalCostUsd, attempts: 1, unpricedAttempts, byModel: [] }
}

function usage(total: number): SessionProjectionMap['tokenUsage'] {
  return { uncachedInputTokens: total, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

const NO_STATUS: SessionStatusSnapshot = new Map()

describe('resolveRootId', () => {
  it('walks parent links and falls back to the bound address for the current session', () => {
    const summaries = { [sid('c')]: row('c', { parentId: sid('b') }), [sid('b')]: row('b', { parentId: sid('a') }), [sid('a')]: row('a') }
    expect(resolveRootId(sid('c'), undefined, summaries)).toBe('a')
    expect(resolveRootId(sid('x'), sid('a'), summaries)).toBe('a')
    expect(resolveRootId(sid('a'), undefined, summaries)).toBe('a')
  })

  it('stops on a cycle instead of looping', () => {
    const summaries = { [sid('a')]: row('a', { parentId: sid('b') }), [sid('b')]: row('b', { parentId: sid('a') }) }
    expect(['a', 'b']).toContain(resolveRootId(sid('a'), undefined, summaries))
  })
})

describe('buildAgentMap', () => {
  const tokens = usage(1200)
  const projections: Record<SessionId, SessionProjectionSnapshot> = {
    [sid('root')]: snapshot({
      subagentCatalog: [entry('w1', 'continuable', 'worker'), entry('w2', 'one-shot', 'reviewer')],
      costUsage: cost(0.5),
    }),
    [sid('w1')]: snapshot({
      subagentCatalog: [entry('g1', 'one-shot')],
      costUsage: cost(0.25, 1),
      tokenUsage: tokens,
      turnOutline: [{ turn: 1, seq: 1 as never, prompt: 'scan the repo', response: '' }],
      todos: [{ content: 'read configs', status: 'completed' }, { content: 'grep tests', status: 'in_progress' }],
    }),
    [sid('w2')]: snapshot({
      subagentCatalog: [],
      subagentTiming: { settledMs: 5, lastTurnCompleted: true },
      turnOutline: [{ turn: 1, seq: 1 as never, prompt: 'review', response: 'LGTM' }],
    }),
    [sid('g1')]: snapshot({
      costUsage: cost(0.125),
      subagentTiming: { settledMs: 5, lastTurnCompleted: false },
    }),
  }
  const summaries: Record<SessionId, SessionSummary> = {
    [sid('root')]: row('root', { displayTitle: 'Main chat' }),
    [sid('w1')]: row('w1', { running: true, parentId: sid('root') }),
    [sid('w2')]: row('w2', { parentId: sid('root') }),
    [sid('g1')]: row('g1', { title: 'grandchild task', parentId: sid('w1') }),
  }

  it('derives hierarchy, state, activity and aggregates', () => {
    const tree = buildAgentMap({ rootId: sid('root'), projections, summaries, statuses: NO_STATUS })
    expect(tree).toMatchObject({ id: 'root', label: 'Main chat', mode: 'root', state: 'idle', address: undefined })
    expect(tree.children.map(child => [child.id, child.label, child.mode, child.state])).toEqual([
      ['w1', 'worker', 'continuable', 'running'],
      ['w2', 'reviewer', 'one-shot', 'completed'],
    ])
    const [worker, reviewer] = tree.children
    expect(worker!.address).toEqual({ parentSessionId: 'root', childSessionId: 'w1', mode: 'continuable' })
    expect(worker).toMatchObject({ task: 'scan the repo', now: 'grep tests', result: undefined, tokens: 1200 })
    expect(reviewer).toMatchObject({ result: 'LGTM', now: undefined })
    const grandchild = worker!.children[0]!
    // A one-shot child without a catalog label falls back to its projected title.
    expect(grandchild).toMatchObject({ label: 'grandchild task', state: 'stopped', costUsd: 0.125 })
    expect(worker!.subtree).toEqual({ agents: 2, active: 1, costUsd: 0.375, unpricedAttempts: 1, tokens: 1200 })
    expect(tree.subtree).toEqual({ agents: 4, active: 1, costUsd: 0.875, unpricedAttempts: 1, tokens: 1200 })
  })

  it('shows waiting-for-user over running and prefers live status to the list row', () => {
    const statuses: SessionStatusSnapshot = new Map([
      [sid('w2'), { running: true, completionUnread: false, pendingInteraction: { key: 'k' } as never }],
      [sid('w1'), { running: false, completionUnread: false, pendingInteraction: undefined }],
    ])
    const tree = buildAgentMap({ rootId: sid('root'), projections, summaries, statuses })
    expect(tree.children.map(child => child.state)).toEqual(['idle', 'waiting'])
    expect(tree.subtree.active).toBe(1)
  })

  it('leaves cost undefined without cost tracking and cuts catalog cycles', () => {
    const cyclic: Record<SessionId, SessionProjectionSnapshot> = {
      [sid('a')]: snapshot({ subagentCatalog: [entry('b', 'continuable')] }),
      [sid('b')]: snapshot({ subagentCatalog: [entry('a', 'continuable')] }),
    }
    const tree = buildAgentMap({ rootId: sid('a'), projections: cyclic, summaries: {}, statuses: NO_STATUS })
    expect(tree.subtree).toEqual({ agents: 2, active: 0, costUsd: undefined, unpricedAttempts: 0, tokens: 0 })
    expect(tree.children[0]!.children).toEqual([])
  })

  it('reports branch lifecycle and lists never-requested catalogs', () => {
    const tree = buildAgentMap({
      rootId: sid('root'),
      projections: {
        [sid('root')]: snapshot({ subagentCatalog: [entry('c1', 'one-shot'), entry('c2', 'one-shot'), entry('c3', 'one-shot')] }, 'idle'),
        [sid('c2')]: snapshot({}, 'loading'),
        [sid('c3')]: { values: {}, state: 'error', error: { code: 'x', message: 'boom' } as never },
      },
      summaries: {},
      statuses: NO_STATUS,
    })
    expect(tree.branch).toBe('ready')
    expect(tree.children.map(child => child.branch)).toEqual(['unknown', 'loading', 'error'])
    expect(tree.children[2]!.branchError).toBe('boom')
    expect(unloadedBranches(tree)).toEqual(['c1'])
    const idleEmpty = buildAgentMap({
      rootId: sid('root'), projections: { [sid('root')]: snapshot({}, 'idle') }, summaries: {}, statuses: NO_STATUS,
    })
    expect(idleEmpty.branch).toBe('unknown')
    expect(unloadedBranches(idleEmpty)).toEqual(['root'])
  })

  it('labels Agent Teams members from the lead roster without importing the Team package', () => {
    const team = {
      members: [
        { id: sid('root'), name: 'lead', role: 'lead' as const, phase: 'active' as const },
        { id: sid('w1'), name: 'alice', role: 'teammate' as const, phase: 'active' as const },
      ],
      tasks: [],
    }
    const withTeam = {
      ...projections,
      [sid('root')]: snapshot(Object.assign({}, projections[sid('root')]!.values, { agentTeam: team })),
    }
    const tree = buildAgentMap({ rootId: sid('root'), projections: withTeam, summaries, statuses: NO_STATUS })
    expect(tree.team).toEqual({ name: 'lead', role: 'lead' })
    expect(tree.children[0]!.team).toEqual({ name: 'alice', role: 'teammate' })
    expect(tree.children[1]!.team).toBeUndefined()
  })
})

describe('buildAgentMap fallbacks', () => {
  it('reads the root from list-row projection values and skips empty prompts', () => {
    const tree = buildAgentMap({
      rootId: sid('r'),
      projections: {
        [sid('r')]: snapshot({ subagentCatalog: [entry('c', 'one-shot', 'child')] }),
        [sid('c')]: snapshot({ costUsage: cost(0.5), turnOutline: [
          { turn: 1, seq: 1 as never, prompt: 'first task', response: '' },
          { turn: 2, seq: 2 as never, prompt: '', response: '' },
        ] }),
      },
      summaries: { [sid('r')]: row('r', { projectionValues: { costUsage: cost(1) } }) },
      statuses: NO_STATUS,
    })
    // The parent has no cost of its own, so the subtree total is the child's alone.
    expect(tree.costUsd).toBeUndefined()
    expect(tree.subtree.costUsd).toBe(0.5)
    expect(tree.children[0]!.task).toBe('first task')
    const bare = buildAgentMap({ rootId: sid('r'), projections: {}, summaries: {}, statuses: NO_STATUS })
    expect(bare).toMatchObject({ label: 'r', branch: 'unknown', task: undefined, result: undefined })
    const viaRow = buildAgentMap({
      rootId: sid('r'), projections: {}, summaries: { [sid('r')]: row('r', { projectionValues: { costUsage: cost(1) } }) }, statuses: NO_STATUS,
    })
    expect(viaRow.costUsd).toBe(1)
  })
})

describe('readTeamRoster', () => {
  it('ignores absent, malformed and partially valid rosters', () => {
    expect(readTeamRoster({}).size).toBe(0)
    expect(readTeamRoster({ agentTeam: 'x' }).size).toBe(0)
    expect(readTeamRoster({ agentTeam: {} }).size).toBe(0)
    expect(readTeamRoster({ agentTeam: { members: 3 } }).size).toBe(0)
    const roster = readTeamRoster({
      agentTeam: { members: [null, { id: 'a', name: 'n', role: 'boss' }, { id: 'b', name: 'ok', role: 'teammate' }] },
    })
    expect([...roster.keys()]).toEqual(['b'])
  })
})
