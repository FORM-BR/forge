/**
 * Form model of one MCP server definition: how a stored definition becomes
 * editable rows, and how the rows become the write-only draft the Host
 * accepts. Stored secrets are never in the model; a row that stands for one
 * says so (`stored`/`keepIndex`) and an untouched row is sent back as "keep".
 */

import type {
  McpArgDraft, McpServerConfigView, McpServerDraft, McpServerSummary,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Transport choices the form offers. */
export type FormTransport = 'stdio' | 'streamable-http'

/** One argument row. */
export interface ArgRow {
  readonly key: number
  /** Index of the stored argument this row came from; absent for rows added in the form. */
  readonly keepIndex?: number
  /** Whether the stored value is hidden (the field starts empty and means "keep"). */
  readonly masked: boolean
  readonly text: string
  /** True once the user typed in the field. */
  readonly edited: boolean
}

/** One environment variable or header row. */
export interface PairRow {
  readonly key: number
  readonly name: string
  /** Name the stored value belongs to; a renamed row cannot keep it. */
  readonly storedName?: string
  /** Replacement value; empty with a stored name means "keep". */
  readonly value: string
}

/** Everything the form edits. */
export interface FormModel {
  /** Entry id being edited; absent when adding. */
  readonly id?: string
  readonly name: string
  readonly transport: FormTransport
  readonly command: string
  readonly args: readonly ArgRow[]
  readonly url: string
  /** Whether the stored URL has hidden parts, so an untouched field means "keep". */
  readonly urlMasked: boolean
  readonly urlEdited: boolean
  readonly env: readonly PairRow[]
  readonly headers: readonly PairRow[]
}

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

let nextKey = 1

/**
 * Fresh row key, unique for the lifetime of the page.
 * @returns the next key.
 */
export function rowKey(): number {
  return nextKey++
}

/**
 * An empty form for a new server.
 * @returns a stdio form with no rows.
 */
export function emptyForm(): FormModel {
  return {
    name: '', transport: 'stdio', command: '', args: [], url: '', urlMasked: false, urlEdited: false, env: [], headers: [],
  }
}

/**
 * Open a stored definition for editing.
 * @param server - the summary the row shows; it carries the secret-free view.
 * @param config - the definition view of that server.
 * @returns the form rows, with hidden values left empty.
 */
export function formFromConfig(server: McpServerSummary, config: McpServerConfigView): FormModel {
  const pairs = (names: readonly string[] | undefined): PairRow[] =>
    (names ?? []).map(name => ({ key: rowKey(), name, storedName: name, value: '' }))
  return {
    id: config.id,
    name: server.serverName,
    transport: server.transport ?? 'stdio',
    command: config.command ?? '',
    args: (config.args ?? []).map((arg, index) => ({
      key: rowKey(), keepIndex: index, masked: arg.masked, text: arg.masked ? '' : arg.text, edited: false,
    })),
    url: config.url ?? '',
    urlMasked: config.urlMasked === true,
    urlEdited: false,
    env: pairs(config.envKeys),
    headers: pairs(config.headerKeys),
  }
}

/** Field a validation message belongs to. */
export type FormField = 'name' | 'command' | 'url' | 'args' | 'env' | 'headers' | 'transport'

/** A problem found before sending. */
export interface FormProblem {
  readonly field: FormField
  readonly code: 'nameRequired' | 'nameInvalid' | 'commandRequired' | 'urlRequired' | 'urlInvalid' | 'pairNameInvalid'
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * Check the form the way the Host will, so the obvious mistakes never leave the page.
 * @param form - the current rows.
 * @returns the first problem per field, in field order.
 */
export function validateForm(form: FormModel): FormProblem[] {
  const problems: FormProblem[] = []
  const name = form.name.trim()
  if (name === '') problems.push({ field: 'name', code: 'nameRequired' })
  else if (!SERVER_NAME.test(name)) problems.push({ field: 'name', code: 'nameInvalid' })
  if (form.transport === 'stdio') {
    if (form.command.trim() === '') problems.push({ field: 'command', code: 'commandRequired' })
    if (form.env.some(row => row.name.trim() !== '' && !ENV_NAME.test(row.name.trim()))) problems.push({ field: 'env', code: 'pairNameInvalid' })
  } else {
    const keepsStored = form.urlMasked && !form.urlEdited
    if (!keepsStored) {
      const url = form.url.trim()
      if (url === '') problems.push({ field: 'url', code: 'urlRequired' })
      else if (!/^https?:\/\/\S+$/i.test(url)) problems.push({ field: 'url', code: 'urlInvalid' })
    }
    if (form.headers.some(row => row.name.trim() !== '' && !HEADER_NAME.test(row.name.trim()))) problems.push({ field: 'headers', code: 'pairNameInvalid' })
  }
  return problems
}

function pairsDraft(rows: readonly PairRow[]): Record<string, string | null> {
  const draft: Record<string, string | null> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '') continue
    draft[name] = row.value === '' && row.storedName === name ? null : row.value
  }
  return draft
}

function argsDraft(rows: readonly ArgRow[]): McpArgDraft[] {
  const draft: McpArgDraft[] = []
  for (const row of rows) {
    if (row.keepIndex !== undefined && !row.edited) draft.push({ keep: row.keepIndex })
    else if (row.text !== '') draft.push({ value: row.text })
  }
  return draft
}

/**
 * Turn the form into the draft the Host takes.
 * @param form - a form that passed {@link validateForm}.
 * @returns the draft; untouched hidden values are sent as "keep".
 */
export function buildDraft(form: FormModel): McpServerDraft {
  const name = form.name.trim()
  if (form.transport === 'stdio') {
    return { name, transport: 'stdio', command: form.command.trim(), args: argsDraft(form.args), env: pairsDraft(form.env) }
  }
  return {
    name,
    transport: 'streamable-http',
    url: form.urlMasked && !form.urlEdited ? null : form.url.trim(),
    headers: pairsDraft(form.headers),
  }
}
