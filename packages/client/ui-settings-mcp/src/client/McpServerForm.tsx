import { useId, useState, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconPlusOutlineRegular, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  buildDraft, rowKey, validateForm,
  type ArgRow, type FormField, type FormModel, type FormProblem, type FormTransport, type PairRow,
} from './draft.ts'
import type { McpSettingsLocaleKey } from './locales.ts'
import css from './McpServerForm.module.css'
import type { McpServerDraft } from '@deepseek-ai/dsh-api-remotes/client'

type Translate = (key: McpSettingsLocaleKey, params?: Record<string, string>) => string

/** What the owner needs to run the save and show its outcome. */
export interface McpServerFormProps {
  readonly initial: FormModel
  readonly t: Translate
  /** Whether a save is in flight. */
  readonly busy: boolean
  /** Message from the Host for the last failed save, with the field it points at when known. */
  readonly failure?: { readonly message: string; readonly field?: string } | undefined
  readonly onSave: (draft: McpServerDraft, id: string | undefined) => void
  readonly onCancel: () => void
}

const PROBLEM_KEYS = {
  nameRequired: 'errNameRequired',
  nameInvalid: 'errNameInvalid',
  commandRequired: 'errCommandRequired',
  urlRequired: 'errUrlRequired',
  urlInvalid: 'errUrlInvalid',
  pairNameInvalid: 'errPairName',
} satisfies Record<FormProblem['code'], McpSettingsLocaleKey>

function update<Row extends { readonly key: number }>(rows: readonly Row[], key: number, patch: Partial<Row>): Row[] {
  return rows.map(row => row.key === key ? { ...row, ...patch } : row)
}

/** Key/value rows for environment variables or headers; stored values stay hidden and write-only. */
function PairEditor({ rows, onChange, labels, t, invalid }: {
  readonly rows: readonly PairRow[]
  readonly onChange: (rows: readonly PairRow[]) => void
  readonly labels: { readonly legend: McpSettingsLocaleKey; readonly add: McpSettingsLocaleKey; readonly kind: 'env' | 'header' }
  readonly t: Translate
  readonly invalid: boolean
}): ReactNode {
  return (
    <fieldset className={css.group} data-mcp-field={labels.kind}>
      <legend className={css.legend}>{t(labels.legend)}</legend>
      {rows.map(row => (
        <div key={row.key} className={css.pair}>
          <input
            className={css.input}
            value={row.name}
            aria-label={t('pairName')}
            aria-invalid={invalid ? true : undefined}
            placeholder={t('pairName')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { onChange(update(rows, row.key, { name: event.target.value })) }}
          />
          <input
            className={css.input}
            type="password"
            value={row.value}
            aria-label={t('pairValue')}
            placeholder={row.storedName !== undefined && row.storedName === row.name ? t('pairValueStored') : t('pairValue')}
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => { onChange(update(rows, row.key, { value: event.target.value })) }}
          />
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('removeRow')}
            title={t('removeRow')}
            onClick={() => { onChange(rows.filter(candidate => candidate.key !== row.key)) }}
          >
            <IconCloseOutlineRegular size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        icon={<IconPlusOutlineRegular size={14} aria-hidden="true" />}
        onClick={() => { onChange([...rows, { key: rowKey(), name: '', value: '' }]) }}
      >
        {t(labels.add)}
      </Button>
      <p className={css.hint}>{t('secretsNote')}</p>
    </fieldset>
  )
}

/** Add or edit one MCP server: name, connection type, and the fields that type needs. */
export function McpServerForm({ initial, t, busy, failure, onSave, onCancel }: McpServerFormProps): ReactNode {
  const [form, setForm] = useState<FormModel>(initial)
  const [problems, setProblems] = useState<readonly FormProblem[]>([])
  const ids = { name: useId(), command: useId(), url: useId(), transport: useId() }
  const editing = initial.id !== undefined
  const problemFor = (field: FormField): FormProblem | undefined => problems.find(problem => problem.field === field)
  const failureFor = (field: FormField): string | undefined => failure?.field === field ? failure.message : undefined
  const patch = (next: Partial<FormModel>): void => { setForm(current => ({ ...current, ...next })) }
  const errorText = (field: FormField): string | undefined => {
    const problem = problemFor(field)
    return problem === undefined ? failureFor(field) : t(PROBLEM_KEYS[problem.code])
  }

  const submit = (): void => {
    const found = validateForm(form)
    setProblems(found)
    if (found.length > 0) return
    onSave(buildDraft(form), form.id)
  }

  const args: readonly ArgRow[] = form.args
  const transportOptions = [
    { value: 'stdio' as const, label: t('transportStdioOption') },
    { value: 'streamable-http' as const, label: t('transportHttpOption') },
  ]

  return (
    <form
      className={css.form}
      aria-label={editing ? t('formEditTitle', { name: initial.name }) : t('formAddTitle')}
      data-mcp-form={editing ? 'edit' : 'add'}
      onSubmit={(event) => { event.preventDefault(); submit() }}
    >
      <h3 className={css.title}>{editing ? t('formEditTitle', { name: initial.name }) : t('formAddTitle')}</h3>

      <div className={css.field}>
        <label htmlFor={ids.name} className={css.label}>{t('fieldName')}</label>
        <input
          id={ids.name}
          className={css.input}
          value={form.name}
          maxLength={32}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errorText('name') === undefined ? undefined : true}
          onChange={(event) => { patch({ name: event.target.value }) }}
        />
        <p className={css.hint}>{t('fieldNameHint')}</p>
        {errorText('name') === undefined ? null : <p className={css.error} role="alert">{errorText('name')}</p>}
      </div>

      <div className={css.field}>
        <span className={css.label} id={ids.transport}>{t('fieldTransport')}</span>
        <SegmentedControl<FormTransport>
          id={`${ids.transport}-control`}
          label={t('fieldTransport')}
          value={form.transport}
          options={transportOptions}
          onChange={(value) => { patch({ transport: value }) }}
        />
      </div>

      <div
        role="tabpanel"
        id={`${ids.transport}-control-${form.transport}-panel`}
        aria-labelledby={`${ids.transport}-control-${form.transport}`}
        className={css.panel}
      >
        {form.transport === 'stdio' ? (
          <>
            <div className={css.field}>
              <label htmlFor={ids.command} className={css.label}>{t('fieldCommand')}</label>
              <input
                id={ids.command}
                className={css.input}
                value={form.command}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errorText('command') === undefined ? undefined : true}
                onChange={(event) => { patch({ command: event.target.value }) }}
              />
              <p className={css.hint}>{t('fieldCommandHint')}</p>
              {errorText('command') === undefined ? null : <p className={css.error} role="alert">{errorText('command')}</p>}
            </div>

            <fieldset className={css.group} data-mcp-field="args">
              <legend className={css.legend}>{t('fieldArgs')}</legend>
              {args.map(row => (
                <div key={row.key} className={css.pair}>
                  <input
                    className={css.input}
                    type={row.masked && !row.edited ? 'password' : 'text'}
                    value={row.text}
                    aria-label={t('fieldArgs')}
                    placeholder={row.masked ? t('argMaskedPlaceholder') : t('argPlaceholder')}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => { patch({ args: update(args, row.key, { text: event.target.value, edited: true }) }) }}
                  />
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('removeRow')}
                    title={t('removeRow')}
                    onClick={() => { patch({ args: args.filter(candidate => candidate.key !== row.key) }) }}
                  >
                    <IconCloseOutlineRegular size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                icon={<IconPlusOutlineRegular size={14} aria-hidden="true" />}
                onClick={() => { patch({ args: [...args, { key: rowKey(), masked: false, text: '', edited: true }] }) }}
              >
                {t('addArg')}
              </Button>
            </fieldset>

            <PairEditor
              rows={form.env}
              onChange={(env) => { patch({ env }) }}
              labels={{ legend: 'fieldEnv', add: 'addEnv', kind: 'env' }}
              t={t}
              invalid={problemFor('env') !== undefined || failure?.field === 'env'}
            />
            {errorText('env') === undefined ? null : <p className={css.error} role="alert">{errorText('env')}</p>}
          </>
        ) : (
          <>
            <div className={css.field}>
              <label htmlFor={ids.url} className={css.label}>{t('fieldUrl')}</label>
              <input
                id={ids.url}
                className={css.input}
                value={form.url}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errorText('url') === undefined ? undefined : true}
                onChange={(event) => { patch({ url: event.target.value, urlEdited: true }) }}
              />
              {form.urlMasked && !form.urlEdited ? <p className={css.hint}>{t('urlMaskedHint')}</p> : null}
              {errorText('url') === undefined ? null : <p className={css.error} role="alert">{errorText('url')}</p>}
            </div>
            <PairEditor
              rows={form.headers}
              onChange={(headers) => { patch({ headers }) }}
              labels={{ legend: 'fieldHeaders', add: 'addHeader', kind: 'header' }}
              t={t}
              invalid={problemFor('headers') !== undefined || failure?.field === 'headers'}
            />
            {errorText('headers') === undefined ? null : <p className={css.error} role="alert">{errorText('headers')}</p>}
          </>
        )}
      </div>

      {failure !== undefined && failure.field === undefined ? <p className={css.error} role="alert" data-mcp-save-error>{failure.message}</p> : null}

      <div className={css.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? t('saving') : t('save')}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </form>
  )
}
