/**
 * A provider's saved API keys: pick which one requests use, add another, drop
 * one, and ask the provider for the balance behind each. The card only edits a
 * draft — the list and the active choice reach the profile when the owning
 * editor applies — and no secret value is ever read back here.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CredentialBalance } from '@deepseek-ai/dsh-api-remotes/client'
import type { en } from './locales.ts'
import type { SavedKeyRow } from './saved-keys.ts'
import { apiKeyFailure } from './apiKey.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link SavedKeys}. */
export interface SavedKeysProps {
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Provider route id (selects the balance endpoint on the Host). */
  provider: string
  /** The rows, active key first. */
  rows: readonly SavedKeyRow[]
  /** References whose secret is only pending in this draft, so the Host cannot be asked about them yet. */
  unsaved: ReadonlySet<string>
  /** Disable edits (read-only settings or a write in flight). */
  disabled: boolean
  /** Make this reference the key requests use. */
  onActivate: (ref: string) => void
  /** Add a key under a label; the editor assigns the reference and keeps the value until apply. */
  onAdd: (label: string, value: string) => void
  /** Drop a non-active key. */
  onRemove: (ref: string) => void
  /** Ask the Host for the balance behind one saved reference. */
  onBalance: (ref: string) => Promise<CredentialBalance | undefined>
}

/** The line shown for one balance outcome. */
function balanceText(t: SavedKeysProps['t'], outcome: CredentialBalance | undefined): string {
  if (outcome === undefined) return t('balanceFailed')
  switch (outcome.status) {
    case 'ok': return `${t('balanceLabel')}: ${outcome.amount ?? ''} ${outcome.currency ?? ''}`.trim()
    case 'unsupported': return t('balanceUnsupported')
    case 'unconfigured': return t('balanceUnconfigured')
    case 'failed': return outcome.detail === undefined ? t('balanceFailed') : `${t('balanceFailed')} (${outcome.detail})`
  }
}

/**
 * Render the saved-keys list for one provider.
 * @param props - rows, gating, and the four edits the owner applies.
 * @returns the section.
 */
export function SavedKeys(props: SavedKeysProps): ReactNode {
  const { t } = props
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [shown, setShown] = useState<Record<string, string>>({})
  const [asking, setAsking] = useState<string | undefined>(undefined)
  const typed = value.trim()
  const failure = apiKeyFailure(value)
  const canAdd = !props.disabled && typed.length > 0 && failure === undefined

  const ask = async (ref: string): Promise<void> => {
    setAsking(ref)
    try {
      const outcome = await props.onBalance(ref)
      setShown(current => ({ ...current, [ref]: balanceText(t, outcome) }))
    } finally {
      setAsking(undefined)
    }
  }

  return (
    <div className={styles['field']}>
      <span className={styles['fieldLabel']}>{t('savedKeys')}</span>
      <ul className={styles['keyRows']}>
        {props.rows.map((row, index) => {
          const active = index === 0
          const name = row.label.length > 0 ? row.label : active ? t('keyMain') : row.ref
          const pending = props.unsaved.has(row.ref)
          return (
            <li key={row.ref} className={styles['keyRow']}>
              <label className={styles['keyName']}>
                <input
                  type="radio"
                  name={`${props.provider}-active-key`}
                  checked={active}
                  disabled={props.disabled}
                  aria-label={`${t('keyUse')} ${name}`}
                  onChange={() => { props.onActivate(row.ref) }}
                />
                <span>{name}</span>
                {active ? <span className={styles['advancedHint']}>{t('keyActive')}</span> : null}
              </label>
              <button
                type="button"
                className={styles['linkButton']}
                disabled={props.disabled || pending || asking !== undefined}
                title={pending ? t('balanceSaveFirst') : undefined}
                onClick={() => { void ask(row.ref) }}
              >
                {asking === row.ref ? t('balanceChecking') : t('balanceCheck')}
              </button>
              {active
                ? null
                : (
                  <button
                    type="button"
                    className={styles['linkButton']}
                    disabled={props.disabled}
                    aria-label={`${t('keyRemove')} ${name}`}
                    onClick={() => { props.onRemove(row.ref) }}
                  >
                    {t('keyRemove')}
                  </button>
                )}
              {shown[row.ref] === undefined ? null : <span className={styles['advancedHint']}>{shown[row.ref]}</span>}
            </li>
          )
        })}
      </ul>
      <div className={styles['keyAdd']}>
        <input
          className={styles['input']}
          type="text"
          value={label}
          placeholder={t('keyLabelPlaceholder')}
          aria-label={t('keyLabel')}
          disabled={props.disabled}
          onChange={(event) => { setLabel(event.target.value) }}
        />
        <input
          className={styles['input']}
          type="password"
          autoComplete="new-password"
          value={value}
          placeholder={t('keyPlaceholder')}
          aria-label={t('keyNewValue')}
          aria-invalid={failure !== undefined}
          disabled={props.disabled}
          onChange={(event) => { setValue(event.target.value) }}
        />
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={!canAdd}
          onClick={() => {
            props.onAdd(label.trim(), typed)
            setLabel('')
            setValue('')
          }}
        >
          {t('keyAdd')}
        </button>
      </div>
      {failure === undefined ? null : <p className={styles['error']}>{t(failure)}</p>}
    </div>
  )
}
