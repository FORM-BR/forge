/**
 * Pure folds for session API cost.
 *
 * The fold reads the same durable events as token-meter but attributes a USD
 * cost to every assistant settlement that reports provider usage: the
 * provider-billed amount when the usage sample carries one, otherwise buckets
 * times the route's catalog rates. A retried attempt resettles the same
 * (turn, step) slot, replacing the failed sample so a slot never double
 * counts; `llm/retry-started` needs no special handling for that reason.
 *
 * @module @deepseek-ai/dsh-cost-meter/cost-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CostModelRow, CostUsageProjection } from './projection.ts'
import type { PriceLookup } from './rates.ts'
import { priceUsage } from './rates.ts'

/** One settled assistant attempt's priced contribution. */
export interface CostAttempt {
  readonly turn: number
  readonly step: number
  readonly provider: string
  readonly model: string
  readonly costUsd: number
  readonly unpriced: boolean
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Durable accumulated fold state; the wire view derives from it. */
export interface CostUsageState {
  readonly totalCostUsd: number
  readonly attempts: number
  readonly unpricedAttempts: number
  readonly byModel: readonly CostModelRow[]
  readonly last: CostAttempt | null
}

const costModelRowSchema = z.object({
  provider: z.string(),
  model: z.string(),
  costUsd: z.number().nonnegative(),
  attempts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const costAttemptSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  provider: z.string(),
  model: z.string(),
  costUsd: z.number().nonnegative(),
  unpriced: z.boolean(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/**
 * The cost-use unit's state schema — the one definition of the state shape;
 * the state type is inferred from it.
 */
const costUsageStateSchema: z.ZodType<CostUsageState> = z.object({
  totalCostUsd: z.number().nonnegative(),
  attempts: z.number().int().nonnegative(),
  unpricedAttempts: z.number().int().nonnegative(),
  byModel: z.array(costModelRowSchema),
  last: costAttemptSchema.nullable(),
}).strict()

export type CostUsageStateSchema = typeof costUsageStateSchema

const costUsageViewSchema: z.ZodType<CostUsageProjection> = z.object({
  totalCostUsd: z.number().nonnegative(),
  attempts: z.number().int().nonnegative(),
  unpricedAttempts: z.number().int().nonnegative(),
  byModel: z.array(costModelRowSchema),
}).strict()

export const initCostUsageState = (): CostUsageState => ({
  totalCostUsd: 0,
  attempts: 0,
  unpricedAttempts: 0,
  byModel: [],
  last: null,
})

/** Add or remove one attempt's contribution from a route's row. */
function adjustModel(
  byModel: readonly CostModelRow[],
  attempt: CostAttempt,
  delta: 1 | -1,
): CostModelRow[] {
  const next = [...byModel]
  const index = next.findIndex(row => row.provider === attempt.provider && row.model === attempt.model)
  const base: CostModelRow = (index === -1 ? undefined : next[index]) ?? {
    provider: attempt.provider,
    model: attempt.model,
    costUsd: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const updated: CostModelRow = {
    provider: base.provider,
    model: base.model,
    costUsd: base.costUsd + delta * attempt.costUsd,
    attempts: base.attempts + (delta === 1 ? 1 : -1),
    inputTokens: base.inputTokens + delta * attempt.inputTokens,
    outputTokens: base.outputTokens + delta * attempt.outputTokens,
    cacheReadTokens: base.cacheReadTokens + delta * attempt.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens + delta * attempt.cacheWriteTokens,
  }
  if (index === -1) {
    next.push(updated)
  } else if (updated.attempts <= 0) {
    next.splice(index, 1)
  } else {
    next[index] = updated
  }
  return next
}

/**
 * The provider-billed USD a usage sample carries, when it is a finite
 * non-negative amount.
 * @param usage - one settlement's usage sample.
 * @returns the billed amount, or `undefined` when the provider reported none.
 */
export function billedCostOf(usage: { readonly costUsd?: number }): number | undefined {
  const cost = usage.costUsd
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined
}

/**
 * Whether an event settles an attempt at a provider-billed amount.
 * @param event - one durable session event.
 * @returns `true` for an assistant settlement whose usage carries a billed cost.
 */
export function isBilledSettlement(event: SessionEvent): boolean {
  return event.type === 'assistant/message'
    && event.data.usage !== undefined
    && billedCostOf(event.data.usage) !== undefined
}

/**
 * Extract one event's priced attempt, or `undefined` when the event carries no
 * priced usage. A provider-billed amount wins over the price lookup. Pure and deterministic for a fixed {@link PriceLookup}; the
 * single source of truth shared by the fold and the SQLite ledger, so both
 * attribute cost with the same validity rules.
 */
export function costAttemptOf(
  event: SessionEvent,
  price: PriceLookup,
): CostAttempt | undefined {
  if (event.type !== 'assistant/message') return undefined
  const usage = event.data.usage
  if (usage === undefined) return undefined
  const source = event.data.message?.source
  if (source === undefined || source.kind !== 'model') return undefined
  const { provider, model } = source
  if (provider.length === 0 || model.length === 0) return undefined

  // A provider-billed amount is the charge itself; the catalog only estimates
  // calls whose provider reported token counts alone.
  const billed = billedCostOf(usage)
  const rates = billed === undefined ? price(provider, model) : undefined
  const unpriced = billed === undefined && rates === undefined
  return {
    turn: event.data.turn,
    step: event.data.step,
    provider,
    model,
    costUsd: billed ?? (rates === undefined ? 0 : priceUsage(usage, rates)),
    unpriced,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * Fold one durable event into a cost state. Pure and deterministic for a
 * fixed {@link PriceLookup}; events without a model-route assistant message or
 * without provider usage leave the state untouched.
 */
export function foldCostUsage(
  state: CostUsageState,
  event: SessionEvent,
  price: PriceLookup,
): CostUsageState {
  const attempt = costAttemptOf(event, price)
  if (attempt === undefined) return state

  const previous = state.last !== null
    && state.last.turn === attempt.turn
    && state.last.step === attempt.step
    ? state.last
    : undefined

  let byModel = state.byModel
  if (previous !== undefined) byModel = adjustModel(byModel, previous, -1)
  byModel = adjustModel(byModel, attempt, 1)

  return {
    totalCostUsd: state.totalCostUsd - (previous?.costUsd ?? 0) + attempt.costUsd,
    attempts: previous === undefined ? state.attempts + 1 : state.attempts,
    unpricedAttempts: state.unpricedAttempts
      - (previous !== undefined && previous.unpriced ? 1 : 0)
      + (attempt.unpriced ? 1 : 0),
    byModel,
    last: attempt,
  }
}

/**
 * The registered `costUsage` projection. The price lookup is captured at
 * registration time; it is deterministic for a fixed catalog, which keeps the
 * fold replay-stable across a process lifetime.
 */
export function costUsageProjectionDefinition(
  price: PriceLookup,
) {
  return {
    key: 'costUsage',
    stateSchema: costUsageStateSchema,
    init: () => initCostUsageState(),
    apply: (state, event) => foldCostUsage(state, event, price),
    // Version 2: v1 checkpoints were folded against the catalog-only lookup,
    // which marked every `openrouterv1` settlement unpriced. The live
    // OpenRouter table changes the fold's result for the same events, so the
    // persisted rows must be discarded instead of restored.
    stateVersion: 2,
    wire: {
      viewSchema: costUsageViewSchema,
      view: state => ({
        totalCostUsd: state.totalCostUsd,
        attempts: state.attempts,
        unpricedAttempts: state.unpricedAttempts,
        byModel: [...state.byModel].sort((left, right) => right.costUsd - left.costUsd),
      }),
    },
  } satisfies ProjectionDefinition<'costUsage', CostUsageState>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    costUsage: CostUsageState
  }
}
