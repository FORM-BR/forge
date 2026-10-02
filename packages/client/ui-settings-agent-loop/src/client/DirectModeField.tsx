/** The direct-mode switch of the agent-loop page: a staged boolean, written only on the form's save. */

import { Switch, Tag, type SettingsFieldState } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DirectModeField.module.css'

/** Copy and staging callbacks the switch needs from the page. */
export interface DirectModeFieldProps {
  /** Staged draft state of the field. */
  state: SettingsFieldState
  /** Disables the switch (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Visible label and accessible name of the switch. */
  label: string
  /** One-line explanation under the label. */
  hint: string
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Stage `'true'` or `'false'` as the draft. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * Render the staged direct-mode switch. Nothing is written here: a click only
 * stages the draft, and the form's Save button performs the write.
 * @param props - the field's copy, its staged state, and the staging callbacks.
 * @returns the labelled switch row.
 */
export function DirectModeField(props: DirectModeFieldProps) {
  return (
    <div className={css.row}>
      <div className={css.text}>
        <div className={css.head}>
          <span className={css.label}>{props.label}</span>
          {props.state.overridden
            ? (
              <span className={css.badges}>
                <Tag tone="neutral">{props.overriddenLabel}</Tag>
                <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onReset}>
                  {props.resetLabel}
                </button>
              </span>
            )
            : null}
        </div>
        <p className={css.hint}>{props.hint}</p>
      </div>
      <Switch
        checked={props.state.text === 'true'}
        disabled={props.disabled}
        label={props.label}
        onChange={(next) => { props.onEdit(next ? 'true' : 'false') }}
      />
    </div>
  )
}
