/** Reasoning-level declaration for one pi-ai model row. */

import type { ReactNode } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * The levels a model may offer, in escalation order, paired with their copy
 * keys. Mirrors `THINKING_LEVELS` of `dsh-llm-pi-ai` (the schema's key union);
 * a level the adapter adds stays configurable in `cordis.patch.yml` until it
 * is named here.
 */
const LEVELS = [
  ['off', 'modelReasoningOff'],
  ['minimal', 'modelReasoningMinimal'],
  ['low', 'modelReasoningLow'],
  ['medium', 'modelReasoningMedium'],
  ['high', 'modelReasoningHigh'],
  ['xhigh', 'modelReasoningXhigh'],
  ['max', 'modelReasoningMax'],
] as const satisfies readonly (readonly [string, ModelsKey])[]

/** Props of {@link ModelReasoningEfforts}. */
interface ModelReasoningEffortsProps {
  /** Effective model row, including fields outside the curated editor. */
  model: DeepSeekModelDraft
  /** One-based row position for the accessible group label. */
  position: number
  /** Prevent changes while read-only or saving. */
  disabled: boolean
  /** Section copy. */
  t: (key: ModelsKey) => string
  /** Replace this row, preserving unrelated configuration. */
  onChange: (model: DeepSeekModelDraft) => void
}

/**
 * The declared level dict of a row. `false` (an explicitly non-reasoning
 * model), an absent key, and any non-object value all read as "no level
 * declared" here.
 * @param value - the row's `reasoningEfforts` field.
 * @returns the level-to-wire-spelling entries, empty when none is declared.
 */
function declaredEfforts(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Edit which reasoning levels one model offers in the composer's Effort row.
 *
 * Each checked level is written with its own name as the wire spelling, except
 * `off`, which is written valueless: the adapter reads that as "supported, send
 * the endpoint's own off value" (`none` on OpenRouter). Spellings a hand-edited
 * profile gave other levels survive toggling the levels around them. Unchecking
 * the last level other than `off` removes the field, returning the model to the
 * built-in catalog's capability; the adapter refuses a dict offering only `off`,
 * so `off` stays unavailable until another level is checked.
 * @param props - model declaration and row replacement action.
 * @returns the labeled level checkboxes.
 */
export function ModelReasoningEfforts({ model, position, disabled, t, onChange }: ModelReasoningEffortsProps): ReactNode {
  const efforts = declaredEfforts(model['reasoningEfforts'])
  const hasLevel = LEVELS.some(([level]) => level !== 'off' && Object.hasOwn(efforts, level))
  const toggle = (level: string, checked: boolean): void => {
    const next = { ...efforts }
    if (checked) next[level] = level === 'off' ? null : level
    else Reflect.deleteProperty(next, level)
    const { reasoningEfforts: _previous, ...rest } = model
    const remaining = LEVELS.some(([key]) => key !== 'off' && Object.hasOwn(next, key))
    onChange(remaining ? { ...rest, reasoningEfforts: next } : rest)
  }
  return (
    <fieldset className={styles['modelInputTypes']} aria-label={`${t('modelReasoning')} ${String(position)}`}>
      <legend className={styles['modelFieldLabel']}>{t('modelReasoning')}</legend>
      <div className={styles['modelInputChoices']}>
        {LEVELS.map(([level, key]) => {
          const checked = Object.hasOwn(efforts, level)
          return (
            <Checkbox
              key={level}
              label={t(key)}
              checked={checked}
              disabled={disabled || (level === 'off' && !hasLevel && !checked)}
              onChange={(next) => { toggle(level, next) }}
            />
          )
        })}
      </div>
      <p className={styles['advancedHint']}>{t('modelReasoningHint')}</p>
    </fieldset>
  )
}
