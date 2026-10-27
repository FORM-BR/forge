/**
 * Comment-preserving edits of the MCP client rows in a patch file's text.
 * Every function is pure (text in, text out): the Host decides which file the
 * text came from and how the result is applied. Rows are recognised only as
 * `@deepseek-ai/dsh-mcp-client` entries inside an `insert` item; anything else
 * in the file, and every field the form does not own (`cwd`, timeouts,
 * `reconnect`, `!!js` expressions), is left exactly as it was.
 *
 * @module @deepseek-ai/dsh-api-mcp-status/patch-file
 */

import { isMap, isScalar, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq } from 'yaml'
import type { Document } from 'yaml'
import { MASK } from './mask.ts'
import type { McpArgDraft, McpServerDraft } from './types.ts'

/** Loader module specifier of the MCP client plugin. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** Tag the Loader gives `!!js` expression scalars. */
const JS_TAG = 'tag:yaml.org,2002:js'

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_ARGS = 64
const MAX_PAIRS = 64
const MAX_TEXT = 4096

/** A rejected edit; `field` names the form field and `kind` the failure class. */
export class McpPatchError extends Error {
  /**
   * @param message - what is wrong, in English, with no submitted secret quoted.
   * @param field - the form field at fault.
   * @param kind - `invalid` for a bad submission, `not-found` for a vanished entry.
   */
  constructor(message: string, readonly field: string, readonly kind: 'invalid' | 'not-found' = 'invalid') {
    super(message)
    this.name = 'McpPatchError'
  }
}

/** One literal argument as stored. */
export interface McpRowArg {
  readonly text: string
  /** True for a `!!js` expression the form cannot show. */
  readonly expression: boolean
}

/** One MCP client row as stored in a patch file. */
export interface McpRow {
  readonly id: string
  readonly disabled: boolean
  /** Literal `serverName`, or the row id when the config does not state one. */
  readonly serverName: string
  readonly transport: 'stdio' | 'streamable-http' | null
  readonly command?: string
  readonly args: readonly McpRowArg[]
  readonly url?: string
  readonly envKeys: readonly string[]
  readonly headerKeys: readonly string[]
  /** False when a field the form owns holds something it cannot represent. */
  readonly editable: boolean
}

interface RowRef {
  readonly id: string
  readonly row: YAMLMap
  readonly parent: YAMLSeq
  readonly item: YAMLMap
}

function openDocument(text: string): Document {
  const document = parseDocument(text, {
    customTags: [{ tag: JS_TAG, resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw new McpPatchError(`The patch file is not valid YAML: ${error.message.split('\n')[0] ?? ''}`, 'file')
  return document
}

function topLevel(document: Document): YAMLSeq {
  if (document.contents === null || (isScalar(document.contents) && document.contents.value === null)) {
    const seq = new YAMLSeq()
    document.contents = seq
    return seq
  }
  if (!isSeq(document.contents)) throw new McpPatchError('The patch file must be a YAML list', 'file')
  return document.contents
}

function literal(node: unknown): string | undefined {
  return isScalar(node) && node.tag !== JS_TAG && typeof node.value === 'string' ? node.value : undefined
}

function refs(top: YAMLSeq): RowRef[] {
  const found: RowRef[] = []
  for (const item of top.items) {
    if (!isMap(item)) continue
    const insert = item.get('insert', true)
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row) || literal(row.get('name', true)) !== MCP_CLIENT_MODULE) continue
      const id = literal(row.get('id', true))
      if (id !== undefined) found.push({ id, row, parent: insert, item })
    }
  }
  return found
}

function view(ref: RowRef): McpRow {
  const config = ref.row.get('config', true)
  const fields = isMap(config) ? config : new YAMLMap()
  const named = literal(fields.get('serverName', true))
  const kind = literal(fields.get('transport', true))
  const transport = kind === 'stdio' || kind === 'streamable-http' ? kind : null
  const command = literal(fields.get('command', true))
  const url = literal(fields.get('url', true))
  const argsNode = fields.get('args', true)
  const args: McpRowArg[] = isSeq(argsNode)
    ? argsNode.items.map(node => literal(node) === undefined ? { text: '', expression: true } : { text: literal(node) ?? '', expression: false })
    : []
  const keysOf = (name: string): string[] => {
    const node = fields.get(name, true)
    return isMap(node) ? node.items.flatMap(pair => literal(pair.key) === undefined ? [] : [literal(pair.key) ?? '']) : []
  }
  const disabledNode = ref.row.get('disabled', true)
  const disabled = isScalar(disabledNode) && disabledNode.value === true
  const mappingOk = (name: string): boolean => {
    const node = fields.get(name, true)
    return node === undefined || (isMap(node) && node.items.every(pair => literal(pair.key) !== undefined))
  }
  const argsOk = argsNode === undefined || (isSeq(argsNode) && args.every(arg => !arg.expression))
  const stateOk = isMap(config) && literal(fields.get('serverName', true)) !== undefined
    && transport !== null
    && (transport === 'stdio' ? command !== undefined : url !== undefined)
    && argsOk && mappingOk('env') && mappingOk('headers')
  return {
    id: ref.id,
    disabled,
    serverName: named ?? ref.id,
    transport,
    ...command === undefined ? {} : { command },
    args,
    ...url === undefined ? {} : { url },
    envKeys: keysOf('env'),
    headerKeys: keysOf('headers'),
    editable: stateOk,
  }
}

/**
 * List the MCP client rows of a patch file.
 * @param text - the file's text; empty text is an empty list.
 * @returns the rows in file order.
 * @throws McpPatchError when the text is not a YAML list.
 */
export function readMcpRows(text: string): McpRow[] {
  const document = openDocument(text)
  if (document.contents === null) return []
  return refs(topLevel(document)).map(view)
}

function ensureText(value: string | undefined, field: string, required: boolean): string | undefined {
  if (value === undefined || value.trim() === '') {
    if (required) throw new McpPatchError(`${field} is required`, field)
    return undefined
  }
  if (value.length > MAX_TEXT) throw new McpPatchError(`${field} is too long`, field)
  return value
}

function ensureUrl(value: string): string {
  if (value.includes(MASK)) throw new McpPatchError('url still contains the hidden-value placeholder; type the full URL', 'url')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (_error) {
    throw new McpPatchError('url is not a valid URL', 'url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new McpPatchError('url must start with http:// or https://', 'url')
  return value
}

function pairNodes(
  draft: Record<string, string | null> | undefined,
  existing: unknown,
  field: 'env' | 'headers',
  keyPattern: RegExp,
): YAMLMap | undefined {
  const entries = Object.entries(draft ?? {})
  if (entries.length === 0) return undefined
  if (entries.length > MAX_PAIRS) throw new McpPatchError(`${field} has too many entries`, field)
  const previous = isMap(existing) ? existing : undefined
  const next = new YAMLMap()
  for (const [key, value] of entries) {
    if (!keyPattern.test(key)) throw new McpPatchError(`${field} name "${key.slice(0, 40)}" is not valid`, field)
    if (value === null) {
      const node = previous?.get(key, true)
      if (node === undefined) throw new McpPatchError(`${field} "${key}" has no stored value to keep; type a value`, field)
      next.set(key, node)
    } else {
      if (value.length > MAX_TEXT) throw new McpPatchError(`${field} value for "${key}" is too long`, field)
      next.set(key, new Scalar(value))
    }
  }
  return next
}

function argNodes(args: readonly McpArgDraft[] | undefined, existing: unknown): YAMLSeq | undefined {
  const list = args ?? []
  if (list.length === 0) return undefined
  if (list.length > MAX_ARGS) throw new McpPatchError('too many arguments', 'args')
  const previous = isSeq(existing) ? existing : undefined
  const seq = new YAMLSeq()
  for (const arg of list) {
    if (arg.keep !== undefined) {
      const node: unknown = previous?.items[arg.keep]
      if (node === undefined) throw new McpPatchError('an unchanged argument no longer exists; reload and try again', 'args')
      seq.items.push(node)
    } else {
      const value = arg.value ?? ''
      if (value.length > MAX_TEXT) throw new McpPatchError('an argument is too long', 'args')
      seq.items.push(new Scalar(value))
    }
  }
  seq.flow = seq.items.length <= 4 && seq.items.every(item => !isScalar(item) || String(item.value).length < 24)
  return seq
}

function setOrDelete(map: YAMLMap, key: string, node: unknown): void {
  if (node === undefined) map.delete(key)
  else map.set(key, node)
}

/** Check the parts of a draft that do not depend on stored state. */
function checkDraft(draft: McpServerDraft): void {
  if (!SERVER_NAME.test(draft.name)) throw new McpPatchError('name must be 1 to 32 letters, digits, "_" or "-"', 'name')
}

function applyDraft(config: YAMLMap, draft: McpServerDraft): void {
  config.set('serverName', draft.name)
  config.set('transport', draft.transport)
  if (draft.transport === 'stdio') {
    const command = ensureText(draft.command, 'command', true) ?? ''
    config.set('command', command)
    setOrDelete(config, 'args', argNodes(draft.args, config.get('args', true)))
    setOrDelete(config, 'env', pairNodes(draft.env, config.get('env', true), 'env', ENV_KEY))
    config.delete('url')
    config.delete('headers')
  } else {
    const stored = literal(config.get('url', true))
    const submitted = draft.url ?? undefined
    if (submitted === undefined || submitted.trim() === '') {
      if (stored === undefined) throw new McpPatchError('url is required', 'url')
    } else {
      config.set('url', ensureUrl(ensureText(submitted, 'url', true) ?? ''))
    }
    setOrDelete(config, 'headers', pairNodes(draft.headers, config.get('headers', true), 'headers', HEADER_KEY))
    config.delete('command')
    config.delete('args')
    config.delete('env')
  }
}

function emit(document: Document, top: YAMLSeq): string {
  top.flow = false
  // Untouched lines must come back as they were: no re-wrapping, no padded flow brackets.
  return document.toString({ lineWidth: 0, flowCollectionPadding: false, singleQuote: true })
}

/**
 * Add one server as its own `insert` item.
 * @param text - the patch file text.
 * @param draft - the submitted definition (a `null` env/header value has nothing to keep here).
 * @param id - Loader entry id for the new row; must be unused in the file.
 * @returns the next file text.
 * @throws McpPatchError when the draft or id is invalid.
 */
export function addMcpRow(text: string, draft: McpServerDraft, id: string): string {
  checkDraft(draft)
  if (!ENTRY_ID.test(id)) throw new McpPatchError('entry id is not valid', 'name')
  const document = openDocument(text)
  const top = topLevel(document)
  if (refs(top).some(ref => ref.id === id)) throw new McpPatchError('an entry with this id already exists', 'name')
  const config = new YAMLMap()
  applyDraft(config, draft)
  const row = new YAMLMap()
  row.set('id', id)
  row.set('name', MCP_CLIENT_MODULE)
  row.set('config', config)
  const insert = new YAMLSeq()
  insert.items.push(row)
  const item = new YAMLMap()
  item.set('insert', insert)
  top.items.push(item)
  return emit(document, top)
}

function find(document: Document, id: string): { top: YAMLSeq; ref: RowRef } {
  const top = topLevel(document)
  const ref = refs(top).find(candidate => candidate.id === id)
  if (ref === undefined) throw new McpPatchError('this server is no longer in the profile configuration', 'id', 'not-found')
  return { top, ref }
}

/**
 * Replace the form-owned fields of one row, keeping everything else.
 * @param text - the patch file text.
 * @param id - Loader entry id of the row.
 * @param draft - the submitted definition; `null` values and `keep` arguments retain stored nodes.
 * @returns the next file text.
 * @throws McpPatchError when the row is missing, not editable, or the draft is invalid.
 */
export function updateMcpRow(text: string, id: string, draft: McpServerDraft): string {
  checkDraft(draft)
  const document = openDocument(text)
  const { top, ref } = find(document, id)
  if (!view(ref).editable) throw new McpPatchError('this entry uses expressions the form cannot edit; change it in the file', 'id')
  const config = ref.row.get('config', true)
  if (!isMap(config)) throw new McpPatchError('this entry has no configuration to edit', 'id')
  applyDraft(config, draft)
  return emit(document, top)
}

/**
 * Switch one row on or off through its `disabled` flag.
 * @param text - the patch file text.
 * @param id - Loader entry id of the row.
 * @param enabled - the wanted state.
 * @returns the next file text; unchanged when the row already is in that state.
 * @throws McpPatchError when the row is missing.
 */
export function setMcpRowEnabled(text: string, id: string, enabled: boolean): string {
  const document = openDocument(text)
  const { top, ref } = find(document, id)
  if (enabled) ref.row.delete('disabled')
  else ref.row.set('disabled', true)
  return emit(document, top)
}

/**
 * Delete one row, and the `insert` item that held it when it was the last one.
 * @param text - the patch file text.
 * @param id - Loader entry id of the row.
 * @returns the next file text.
 * @throws McpPatchError when the row is missing.
 */
export function removeMcpRow(text: string, id: string): string {
  const document = openDocument(text)
  const { top, ref } = find(document, id)
  ref.parent.items.splice(ref.parent.items.indexOf(ref.row), 1)
  if (ref.parent.items.length === 0) {
    const siblings = [...ref.item.items].filter(pair => !(isScalar(pair.key) && pair.key.value === 'insert'))
    if (siblings.length === 0) top.items.splice(top.items.indexOf(ref.item), 1)
    else ref.item.delete('insert')
  }
  return emit(document, top)
}
