import type { Volatile } from '@deepseek-ai/cordis'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
  /**
   * Business profile per Workspace: Workspace directory path to the preset new
   * sessions in that Workspace start with. Edited through Settings; an absent
   * path leaves the Workspace on the default preset.
   */
  workspacePresets: Volatile<Record<string, string> | undefined>
}
