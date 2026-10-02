// @vitest-environment jsdom
/** Agent Map tab: tree rendering, navigation, collapse, lazy catalog reads and cost. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-cost-meter/client'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SessionListState, SessionSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AgentMapTab, AgentMapTitle, type AgentMapTabProps } from '../src/client/agent-map/AgentMapTab.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const sid = (id: string): SessionId => id as SessionId
const ROOT = sid('root')
const WORKER = sid('worker')
const SCOUT = sid('scout')


function summary(id: SessionId, partial: Partial<SessionSummary> = {}): SessionSummary {
  return { id, displayTitle: id, running: false, retainedBy: {}, blank: false, updatedAt: 1, ...partial }
}

interface Fixture {
  readonly projections?: SessionListState['projectionsBySession']
  readonly summaries?: Record<SessionId, SessionSummary>
  readonly statuses?: SessionStatusSnapshot
  readonly current?: SessionId
  readonly boundParent?: SessionId
}

const FAMILY: Fixture = {
  projections: {
    [ROOT]: {
      state: 'ready', error: null,
      values: {
        subagentCatalog: [
          { id: WORKER, mode: 'continuable', label: 'worker', createdAt: 1 },
          { id: SCOUT, mode: 'one-shot', label: 'scout', createdAt: 2 },
        ],
        costUsage: { totalCostUsd: 0.5, attempts: 2, unpricedAttempts: 0, byModel: [] },
      },
    },
    [WORKER]: {
      state: 'ready', error: null,
      values: {
        subagentCatalog: [],
        costUsage: { totalCostUsd: 0.25, attempts: 1, unpricedAttempts: 0, byModel: [] },
        tokenUsage: { uncachedInputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
        todos: [{ content: 'grep the tests', status: 'in_progress' }],
        turnOutline: [{ turn: 1, seq: 1 as never, prompt: 'scan the repo', response: '' }],
      },
    },
  },
  summaries: {
    [ROOT]: summary(ROOT, { displayTitle: 'Main chat' }),
    [WORKER]: summary(WORKER, { running: true, parentId: ROOT }),
    [SCOUT]: summary(SCOUT, { parentId: ROOT }),
  },
}

function bench(fixture: Fixture = FAMILY) {
  const current = fixture.current ?? ROOT
  const state = {
    ids: [ROOT],
    byId: fixture.summaries ?? {},
    phase: 'ready',
    projectionsBySession: fixture.projections ?? {},
  } satisfies SessionListState
  const snapshot: SessionSnapshot = {
    ...sessionSnapshot(current),
    subagent: fixture.boundParent === undefined
      ? null
      : { address: { parentSessionId: fixture.boundParent, childSessionId: current, mode: 'continuable' } },
  }
  const actions = {
    openChild: vi.fn(),
    openChildAside: vi.fn(),
    openRoot: vi.fn(),
    refreshProjection: vi.fn(),
  }
  const props = {
    sessionId: current,
    useSessions: <T,>(select: (value: SessionListState) => T): T => select(state),
    useSessionStatus: <T,>(select: (value: SessionStatusSnapshot) => T): T => select(fixture.statuses ?? new Map()),
    useSession: <T,>(select: (value: SessionSnapshot) => T): T => select(snapshot),
    t: makeTranslate(zh),
    ...actions,
  }
  // The slot runtime supplies the remaining standard props; the tab reads none of them.
  return { props: props as never as AgentMapTabProps, actions }
}

describe('AgentMapTab', () => {
  it('renders the delegation tree with state, activity, task and cost', () => {
    const { props } = bench()
    render(<AgentMapTab {...props} />)

    expect(screen.getAllByRole('treeitem').map(item => item.getAttribute('aria-level'))).toEqual(['1', '2', '2'])
    expect(screen.getByText('Main chat')).toBeTruthy()
    // Team total: root 0.50 + worker 0.25, scout reports nothing.
    expect(screen.getByText('$0.75')).toBeTruthy()
    expect(screen.getByText('3 个智能体')).toBeTruthy()
    expect(screen.getByText('1 个正在工作')).toBeTruthy()

    const workerRow = document.querySelector<HTMLElement>('[data-agent-node="worker"]')!
    expect(within(workerRow).getByText('可继续 · 正在运行')).toBeTruthy()
    expect(within(workerRow).getByText('正在做：grep the tests')).toBeTruthy()
    expect(within(workerRow).getByText('$0.25')).toBeTruthy()
    expect(within(workerRow).getByText('1.2K tok')).toBeTruthy()
    expect(screen.getAllByText('1.2K tok')).toHaveLength(2)
    const scoutRow = document.querySelector<HTMLElement>('[data-agent-node="scout"]')!
    expect(within(scoutRow).getByText('一次性 · 当前未运行')).toBeTruthy()
    // No cost projection: a dash instead of a fabricated zero.
    expect(within(scoutRow).getByText('—')).toBeTruthy()
    // The root carries the subtree total because it has children.
    const rootRow = document.querySelector<HTMLElement>('[data-agent-node="root"]')!
    expect(within(rootRow).getByText('含下级：$0.75')).toBeTruthy()
    expect(screen.getByText('当前会话')).toBeTruthy()
  })

  it('opens the root and children with their exact subagent addresses', () => {
    const { props, actions } = bench()
    render(<AgentMapTab {...props} />)
    const buttons = screen.getAllByRole('button', { name: zh['map.open'] })
    fireEvent.click(buttons[0]!)
    fireEvent.click(buttons[1]!)
    expect(actions.openRoot).toHaveBeenCalledWith(ROOT)
    expect(actions.openChild).toHaveBeenCalledWith({ parentSessionId: ROOT, childSessionId: WORKER, mode: 'continuable' })
    fireEvent.click(screen.getByRole('button', { name: '在侧边栏打开 scout' }))
    expect(actions.openChildAside).toHaveBeenCalledWith({ parentSessionId: ROOT, childSessionId: SCOUT, mode: 'one-shot' })
  })

  it('collapses and expands a branch', () => {
    const { props } = bench()
    render(<AgentMapTab {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '收起 Main chat 的下级子智能体' }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '展开 Main chat 的下级子智能体' }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
  })

  it('requests each never-read catalog exactly once and shows the empty state', () => {
    const empty = bench({
      projections: { [ROOT]: { state: 'ready', error: null, values: { subagentCatalog: [] } } },
      summaries: { [ROOT]: summary(ROOT) },
    })
    render(<AgentMapTab {...empty.props} />)
    expect(screen.getByText(zh['map.empty'])).toBeTruthy()
    expect(empty.actions.refreshProjection).not.toHaveBeenCalled()

    cleanup()
    const { props, actions } = bench({
      projections: {
        [ROOT]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: SCOUT, mode: 'one-shot', createdAt: 1 }] } },
      },
      summaries: { [ROOT]: summary(ROOT), [SCOUT]: summary(SCOUT, { parentId: ROOT }) },
    })
    const view = render(<AgentMapTab {...props} />)
    expect(actions.refreshProjection).toHaveBeenCalledTimes(1)
    expect(actions.refreshProjection).toHaveBeenCalledWith(SCOUT)
    view.rerender(<AgentMapTab {...props} />)
    expect(actions.refreshProjection).toHaveBeenCalledTimes(1)
  })

  it('labels every state, mode and Agent Teams role', () => {
    const roster = {
      members: [
        { id: ROOT, name: 'boss', role: 'lead' as const, phase: 'active' as const },
        { id: sid('stopped'), name: 'alice', role: 'teammate' as const, phase: 'active' as const },
      ],
      tasks: [],
    }
    const { props } = bench({
      projections: {
        [ROOT]: {
          state: 'ready', error: null,
          values: {
            subagentCatalog: [
              { id: sid('done'), mode: 'one-shot', createdAt: 1 },
              { id: sid('stopped'), mode: 'continuable', label: 'stopped', createdAt: 2 },
              { id: sid('mystery'), mode: 'unknown', createdAt: 3 },
              { id: sid('pending'), mode: 'one-shot', label: 'pending', createdAt: 4 },
            ],
            agentTeam: roster,
          },
        },
        [sid('done')]: { state: 'ready', error: null, values: { subagentTiming: { settledMs: 0, lastTurnCompleted: true }, turnOutline: [{ turn: 1, seq: 1 as never, prompt: 'p', response: 'all green' }] } },
        [sid('stopped')]: { state: 'ready', error: null, values: { subagentTiming: { settledMs: 0, lastTurnCompleted: false } } },
        [sid('mystery')]: { state: 'loading', error: null, values: {} },
        [sid('pending')]: { state: 'ready', error: null, values: { subagentCatalog: [], turnOutline: [{ turn: 1, seq: 1 as never, prompt: 'pending', response: '' }] } },
      },
      summaries: {
        [ROOT]: summary(ROOT),
        [sid('done')]: summary(sid('done'), { parentId: ROOT }),
        [sid('stopped')]: summary(sid('stopped'), { parentId: ROOT }),
        [sid('mystery')]: summary(sid('mystery'), { parentId: ROOT }),
        [sid('pending')]: summary(sid('pending'), { parentId: ROOT }),
      },
    })
    render(<AgentMapTab {...props} />)
    const text = (id: string): string => document.querySelector<HTMLElement>(`[data-agent-node="${id}"]`)!.textContent ?? ''
    expect(text('done')).toContain('一次性 · 已完成')
    expect(text('done')).toContain('结果：all green')
    expect(text('stopped')).toContain('可继续 · 已中断')
    expect(text('stopped')).toContain('团队成员 alice')
    expect(text('mystery')).toContain('模式未知 · 当前未运行')
    expect(text('mystery')).toContain(zh['map.loading'])
    // A prompt identical to the label adds no second line.
    expect(text('pending')).not.toContain('pending pending')
    expect(text('root')).toContain('团队负责人')
  })

  it('anchors the tree at the top ancestor when the Sidebar belongs to a child session', () => {
    const { props } = bench({ ...FAMILY, current: WORKER, boundParent: ROOT })
    render(<AgentMapTab {...props} />)
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
    const worker = document.querySelector<HTMLElement>('[data-agent-node="worker"]')!
    expect(worker.getAttribute('aria-selected')).toBe('true')
    expect(within(worker).getByText('当前会话')).toBeTruthy()
  })

  it('offers a retry for a failed catalog read and a waiting state for pending interactions', () => {
    const statuses: SessionStatusSnapshot = new Map([[SCOUT, {
      running: true, completionUnread: false, pendingInteraction: { key: 'ask' } as never,
    }]])
    const { props, actions } = bench({
      projections: {
        [ROOT]: { state: 'ready', error: null, values: { subagentCatalog: [{ id: SCOUT, mode: 'one-shot', createdAt: 1 }, { id: sid('quiet'), mode: 'one-shot', createdAt: 2 }] } },
        [SCOUT]: { state: 'error', error: { code: 'x', message: 'read failed' } as never, values: {} },
        [sid('quiet')]: { state: 'error', error: null, values: {} },
      },
      summaries: {
        [ROOT]: summary(ROOT), [SCOUT]: summary(SCOUT, { parentId: ROOT }), [sid('quiet')]: summary(sid('quiet'), { parentId: ROOT }),
      },
      statuses,
    })
    render(<AgentMapTab {...props} />)
    expect(screen.getByText('一次性 · 等待你的操作')).toBeTruthy()
    expect(screen.getByText('read failed')).toBeTruthy()
    // A failed read without a message falls back to the generic copy.
    expect(screen.getByText(zh['load.error'])).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh.retry })[0]!)
    expect(actions.refreshProjection).toHaveBeenCalledWith(SCOUT)
  })

  it('advances running durations once per second', () => {
    vi.useFakeTimers()
    const base = Date.now()
    const { props } = bench({
      ...FAMILY,
      summaries: {
        ...FAMILY.summaries,
        [WORKER]: summary(WORKER, {
          running: true, parentId: ROOT,
          projectionValues: { subagentTiming: { settledMs: 0, active: { since: base, through: base } } },
        }),
      },
    })
    render(<AgentMapTab {...props} />)
    const worker = document.querySelector<HTMLElement>('[data-agent-node="worker"]')!
    expect(within(worker).getAllByText('0秒').length).toBeGreaterThan(0)
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(within(worker).getAllByText('3秒').length).toBeGreaterThan(0)
  })

  it('shows the localized tab chip', () => {
    const { props } = bench()
    render(<AgentMapTitle {...props as never as Parameters<typeof AgentMapTitle>[0]} />)
    expect(screen.getByText(zh['map.title'])).toBeTruthy()
    expect(en['map.title']).toBe('Agent Map')
  })
})
