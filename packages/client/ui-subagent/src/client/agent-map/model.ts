/**
 * Pure Agent Map model: folds the shared Session list, projection catalogs and
 * live status into one delegation tree with per-agent state, current activity
 * and cost. React-free so every derivation is unit-testable.
 */
import type {
  SessionProjectionMap, SessionProjectionSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
// Type-only: pull the `costUsage`, `turnOutline`, and `todos` SessionProjectionMap merges into this module.
import type {} from '@deepseek-ai/dsh-cost-meter/client'
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import { tokenTotal } from '../metrics.ts'

/** Live condition of one agent, ordered by how much attention it needs. */
export type AgentMapState = 'waiting' | 'running' | 'stopped' | 'completed' | 'idle'

/** Lifecycle mode of one agent; the root conversation has no subagent mode. */
export type AgentMapMode = 'root' | 'one-shot' | 'continuable' | 'unknown'

/** Lifecycle of the read that discovers the agent's own children; `unknown` means never requested. */
export type AgentMapBranch = 'unknown' | 'loading' | 'ready' | 'error'

/** Agent Teams identity of a node, read from the lead Session's roster. */
export interface AgentMapTeamRole {
  readonly name: string
  readonly role: 'lead' | 'teammate'
}

/** Costs and usage summed over one node and all of its descendants. */
export interface AgentMapSubtree {
  /** Agents in the subtree, the node included. */
  readonly agents: number
  /** Agents currently running or waiting for the user. */
  readonly active: number
  /** Summed catalog-priced USD, or undefined when no node reports a cost. */
  readonly costUsd: number | undefined
  /** Settled attempts without a catalog price anywhere in the subtree. */
  readonly unpricedAttempts: number
  /** Summed provider tokens over the nodes that report usage. */
  readonly tokens: number
}

/** One agent in the delegation tree. */
export interface AgentMapNode {
  readonly id: SessionId
  readonly label: string
  readonly mode: AgentMapMode
  readonly state: AgentMapState
  readonly branch: AgentMapBranch
  /** Message of a failed catalog read for this node's children. */
  readonly branchError: string | undefined
  /** Routing address that opens this agent; absent for the root. */
  readonly address: SubagentAddress | undefined
  /** Newest non-empty prompt preview of the agent. */
  readonly task: string | undefined
  /** In-progress todo of a live agent. */
  readonly now: string | undefined
  /** Final response preview of the latest closed turn of an idle agent. */
  readonly result: string | undefined
  readonly team: AgentMapTeamRole | undefined
  /** Summary row used for token and duration metrics. */
  readonly summary: SessionSummary | undefined
  readonly costUsd: number | undefined
  readonly unpricedAttempts: number
  readonly tokens: number | undefined
  readonly children: readonly AgentMapNode[]
  readonly subtree: AgentMapSubtree
}

/** Shared-store facts the map reads. */
export interface AgentMapInput {
  readonly rootId: SessionId
  readonly projections: Readonly<Record<SessionId, SessionProjectionSnapshot>>
  readonly summaries: Readonly<Record<SessionId, SessionSummary>>
  readonly statuses: SessionStatusSnapshot
}

type ProjectionValues = Readonly<Partial<SessionProjectionMap>>

const NO_VALUES: ProjectionValues = {}

/**
 * Find the top of the delegation tree that contains a Session.
 * @param sessionId - Session whose Sidebar hosts the map.
 * @param boundParent - direct parent from the Session's own subagent address, when known.
 * @param summaries - Session list rows carrying `parentId` links from loaded catalogs.
 * @returns the highest ancestor known to the client, or the Session itself.
 */
export function resolveRootId(
  sessionId: SessionId,
  boundParent: SessionId | undefined,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): SessionId {
  const seen = new Set<SessionId>()
  let current = sessionId
  while (!seen.has(current)) {
    seen.add(current)
    const parent = summaries[current]?.parentId ?? (current === sessionId ? boundParent : undefined)
    if (parent === undefined) return current
    current = parent
  }
  return current
}

interface TeamMemberFact {
  readonly name: string
  readonly role: 'lead' | 'teammate'
}

/** Whether an unknown roster row carries the fields the map labels with. */
function isTeamMember(value: unknown): value is { id: string; name: string; role: 'lead' | 'teammate' } {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'role' in value && (value.role === 'lead' || value.role === 'teammate')
}

/**
 * Read the Agent Teams roster published on a lead Session, when that
 * experimental projection exists. The key is read structurally because this
 * stable package must not depend on the experimental Team package.
 * @param values - projection values of the root Session.
 * @returns member facts by Session id; empty without a roster.
 */
export function readTeamRoster(values: object): ReadonlyMap<string, TeamMemberFact> {
  const roster = new Map<string, TeamMemberFact>()
  const entries: [string, unknown][] = Object.entries(values)
  const published = entries.find(([key]) => key === 'agentTeam')?.[1]
  if (typeof published !== 'object' || published === null || !('members' in published)) return roster
  const members = published.members
  if (!Array.isArray(members)) return roster
  for (const member of members) {
    if (isTeamMember(member)) roster.set(member.id, { name: member.name, role: member.role })
  }
  return roster
}

function branchOf(snapshot: SessionProjectionSnapshot | undefined): AgentMapBranch {
  if (snapshot === undefined) return 'unknown'
  // `idle` without a catalog value means no explicit read was requested yet.
  if (snapshot.state === 'idle') return snapshot.values.subagentCatalog === undefined ? 'unknown' : 'ready'
  return snapshot.state
}

function stateOf(
  id: SessionId,
  summary: SessionSummary | undefined,
  values: ProjectionValues,
  statuses: SessionStatusSnapshot,
): AgentMapState {
  const status = statuses.get(id)
  if (status?.pendingInteraction !== undefined) return 'waiting'
  if ((status?.running ?? summary?.running) === true) return 'running'
  const completed = values.subagentTiming?.lastTurnCompleted
  if (completed === true) return 'completed'
  return completed === false ? 'stopped' : 'idle'
}

function latestPrompt(values: ProjectionValues): string | undefined {
  const turns = values.turnOutline ?? []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const prompt = turns[index]?.prompt
    if (prompt !== undefined && prompt !== '') return prompt
  }
  return undefined
}

function latestResponse(values: ProjectionValues): string | undefined {
  const response = values.turnOutline?.at(-1)?.response
  return response === undefined || response === '' ? undefined : response
}

function liveTodo(values: ProjectionValues): string | undefined {
  return values.todos?.find(todo => todo.status === 'in_progress')?.content
}

function summarize(node: Omit<AgentMapNode, 'subtree'>, children: readonly AgentMapNode[]): AgentMapSubtree {
  let agents = 1
  let active = node.state === 'running' || node.state === 'waiting' ? 1 : 0
  let costUsd = node.costUsd
  let unpricedAttempts = node.unpricedAttempts
  let tokens = node.tokens ?? 0
  for (const child of children) {
    agents += child.subtree.agents
    active += child.subtree.active
    unpricedAttempts += child.subtree.unpricedAttempts
    tokens += child.subtree.tokens
    if (child.subtree.costUsd !== undefined) costUsd = (costUsd ?? 0) + child.subtree.costUsd
  }
  return { agents, active, costUsd, unpricedAttempts, tokens }
}

/**
 * Build the delegation tree rooted at one Session. Nodes whose catalog has not
 * loaded are leaves with `branch: 'unknown'`; cycles in malformed catalogs are
 * cut at the repeated id.
 * @param input - shared Session store facts and the root identity.
 * @returns the root node with its descendants.
 */
export function buildAgentMap(input: AgentMapInput): AgentMapNode {
  const { rootId, projections, summaries, statuses } = input
  const team = readTeamRoster(projections[rootId]?.values ?? summaries[rootId]?.projectionValues ?? NO_VALUES)
  const visited = new Set<SessionId>()

  const visit = (
    id: SessionId,
    parentId: SessionId | undefined,
    entry: SessionProjectionMap['subagentCatalog'][number] | undefined,
  ): AgentMapNode => {
    visited.add(id)
    const snapshot = projections[id]
    const summary = summaries[id]
    const values = snapshot?.values ?? summary?.projectionValues ?? NO_VALUES
    const state = stateOf(id, summary, values, statuses)
    const live = state === 'running' || state === 'waiting'
    const children: AgentMapNode[] = []
    for (const child of snapshot?.values.subagentCatalog ?? []) {
      if (!visited.has(child.id)) children.push(visit(child.id, id, child))
    }
    const mode: AgentMapMode = entry === undefined ? 'root' : entry.mode
    const roster = team.get(id)
    const base: Omit<AgentMapNode, 'subtree'> = {
      id,
      label: entry === undefined
        ? summary?.displayTitle ?? id
        : entry.label ?? summary?.title ?? id,
      mode,
      state,
      branch: branchOf(snapshot),
      branchError: snapshot?.error?.message,
      address: entry === undefined || parentId === undefined
        ? undefined
        : { parentSessionId: parentId, childSessionId: id, mode: entry.mode },
      task: latestPrompt(values),
      now: live ? liveTodo(values) : undefined,
      result: live ? undefined : latestResponse(values),
      team: roster === undefined ? undefined : { name: roster.name, role: roster.role },
      summary,
      costUsd: values.costUsage?.totalCostUsd,
      unpricedAttempts: values.costUsage?.unpricedAttempts ?? 0,
      tokens: tokenTotal(values.tokenUsage),
      children,
    }
    return { ...base, subtree: summarize(base, children) }
  }

  return visit(rootId, undefined, undefined)
}

/**
 * List the nodes whose child catalog the client has never requested.
 * @param root - map root.
 * @returns Session ids to refresh so the tree can grow to its full depth.
 */
export function unloadedBranches(root: AgentMapNode): SessionId[] {
  const out: SessionId[] = []
  const walk = (node: AgentMapNode): void => {
    if (node.branch === 'unknown') out.push(node.id)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}
