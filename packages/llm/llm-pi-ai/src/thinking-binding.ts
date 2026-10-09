/**
 * Anthropic signs every `thinking` block against the request prefix it was
 * generated with. When a later turn replays such a block after earlier content
 * legitimately changed between turns (compaction, rewritten tool results,
 * re-linked history), the API rejects the whole request with `Invalid
 * signature in thinking block` unless the call opts into dropping stale
 * blocks: `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`,
 * gated behind the `anthropic-beta: thinking-binding-controls-2026-08-01`
 * header.
 *
 * pi-ai already sends that escape hatch, but only for models declaring
 * `compat.supportsMidConvoEffort`; first-party Anthropic models without the
 * flag replay signed blocks unbound and 400 on the second tool turn. This
 * module mutates the request body pi-ai built so the remaining Anthropic
 * models get the same treatment, wired through pi-ai's `onPayload` hook.
 */

/** The beta that enables `block_binding` on Messages API thinking blocks. */
export const ANTHROPIC_THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01'

const PREFIX_MISMATCH_BEHAVIOR = Object.freeze({ prefix_mismatch_behavior: 'drop_block' })

/** The minimal request-body surface this mutator touches. */
interface ThinkingBody {
  betas?: unknown
  thinking?: unknown
}

/**
 * Bind an Anthropic request's thinking blocks loosely: when a replayed signed
 * block no longer matches its conversation prefix, drop it instead of failing
 * the turn, and declare the beta that allows the field. Mutates `params` in
 * place and resolves to `undefined` so pi-ai keeps the exact body it built.
 *
 * @param params - the request body pi-ai constructed for one Anthropic call.
 * @param reasoning - whether the model declares reasoning support; such
 * models emit signed thinking even when pi-ai configures no `thinking` field
 * (e.g. `off` unmapped on managed-effort models), so the binding must be
 * declared explicitly for them.
 * @returns `undefined`; pi-ai treats that as "keep the mutated body".
 */
export function dropStaleThinkingBlocks(params: unknown, reasoning: boolean): undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const body = params as ThinkingBody
  const thinking = body.thinking
  const thinkingType = typeof thinking === 'object' && thinking !== null && !Array.isArray(thinking)
    ? (thinking as { type?: unknown }).type
    : undefined
  // A plainly disabled model emits no signed blocks; nothing to bind.
  if (thinkingType === 'disabled') return undefined
  if (thinkingType === undefined && !reasoning) return undefined

  const blockBinding = { ...PREFIX_MISMATCH_BEHAVIOR }
  if (thinkingType === undefined) {
    // The model will think anyway (its engine default); ask for adaptive
    // thinking so the API can drop a stale block rather than reject the turn.
    body.thinking = { type: 'adaptive', display: 'summarized', block_binding: blockBinding }
  } else {
    ;(thinking as { block_binding?: unknown }).block_binding = blockBinding
  }
  const betas = body.betas
  if (Array.isArray(betas)) {
    if (!betas.includes(ANTHROPIC_THINKING_BINDING_BETA)) {
      betas.push(ANTHROPIC_THINKING_BINDING_BETA)
    }
  } else {
    body.betas = [ANTHROPIC_THINKING_BINDING_BETA]
  }
  return undefined
}
