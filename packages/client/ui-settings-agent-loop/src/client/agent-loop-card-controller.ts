/** The agent-loop page's staged form over the `agent-loop` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

/**
 * The agent-loop fields this page edits. The Host section carries only these
 * fields — the composed `agents` array is deliberately not part of it.
 */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
  /** Whether the direct-mode prompt policy is on. */
  directMode?: boolean
}

/** What the agent-loop page renders. */
export interface AgentLoopCardState extends SettingsFormShell {
  /** Parallel tool-call cap. */
  maxParallelToolCalls: SettingsFieldState
  /** Direct-mode switch; the draft text is `'true'` or `'false'`. */
  directMode: SettingsFieldState
}

/**
 * A boolean field staged as the text `'true'` or `'false'`. An empty draft
 * clears the field; any other text blocks the save.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true' || trimmed === 'false') return { kind: 'set', value: trimmed === 'true' }
      return undefined
    },
  }
}

/** The registration-side face the agent-loop page's slot entry injects. */
export interface AgentLoopCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
}

/** Bridges the `agent-loop` scope onto the page's staged form. */
export class AgentLoopCardController {
  private readonly form: SettingsFormModel<AgentLoopSettings>
  private readonly store: SnapshotStore<AgentLoopCardState>

  /** @param scope - the bound settings scope for the `agent-loop` namespace. */
  constructor(scope: SettingsFormScope<AgentLoopSettings>) {
    this.form = new SettingsFormModel(scope, [settingsNumberField('maxParallelToolCalls'), settingsBooleanField('directMode')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AgentLoopCardState {
    return {
      ...this.form.shell(),
      maxParallelToolCalls: this.form.field('maxParallelToolCalls'),
      directMode: this.form.field('directMode'),
    }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): AgentLoopCardFace {
    return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }
  }
  /** Release accepted-value subscriptions. */
  dispose(): void { this.form.dispose() }

}
