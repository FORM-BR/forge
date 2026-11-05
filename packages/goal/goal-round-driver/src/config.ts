/**
 * Configuration normalization for same-session goal continuation.
 *
 * @module @deepseek-ai/dsh-goal-round-driver/config
 */

import z from '@deepseek-ai/schemastery'

/** User-facing goal continuation configuration. */
export interface Config {
  /**
   * Tool calls admitted by one goal's agent between enforced re-anchor rounds.
   * A positive cadence makes every Nth round re-anchor the objective onto the
   * current workspace instructions and memory/feedback anchors; 0 disables
   * re-anchoring. Defaults to 5.
   */
  reanchorCadence?: number
}

export const Config: z<Config> = z.object({
  reanchorCadence: z.number().step(1).min(0).default(5),
})

/** Normalized goal continuation configuration. */
export interface ResolvedConfig {
  reanchorCadence: number
}

/**
 * Resolve defaults for one config object.
 * @param config - user-facing plugin configuration.
 * @returns normalized runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    reanchorCadence: config.reanchorCadence ?? 5,
  }
}
