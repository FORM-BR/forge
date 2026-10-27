/**
 * Pure bookkeeping for a provider's saved API keys. The active key is the
 * profile's `apiKeyEnv`; the others live in `apiKeys` (`{ ref, label }`), each
 * holding its secret under its own credential reference. Switching the active
 * key therefore only repoints `apiKeyEnv` — requests resolve it per call — and
 * nothing here ever sees a secret value.
 */

/** One row of the saved-keys list. */
export interface SavedKeyRow {
  /** Credential reference holding the key. */
  readonly ref: string
  /** Name shown for the row; empty when the profile never named it. */
  readonly label: string
}

/** The list shape the profile stores. */
export type SavedKeyEntries = readonly { readonly ref: string; readonly label?: string }[]

/** Reference grammar of the credential seam (a POSIX-style identifier). */
const REF_GRAMMAR = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Normalize the stored `apiKeys` value, dropping anything malformed so a
 * hand-edited profile cannot break the page.
 * @param value - the raw `apiKeys` member of a profile draft.
 * @returns the well-formed entries in stored order.
 */
export function entriesOf(value: unknown): { ref: string; label: string }[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: { ref: string; label: string }[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { ref, label } = item as { ref?: unknown; label?: unknown }
    if (typeof ref !== 'string' || !REF_GRAMMAR.test(ref) || seen.has(ref)) continue
    seen.add(ref)
    out.push({ ref, label: typeof label === 'string' ? label : '' })
  }
  return out
}

/**
 * The rows to show: the active reference first (the profile's current key,
 * even when it is not listed yet), then every other saved key.
 * @param activeRef - the reference requests currently resolve.
 * @param entries - the stored list.
 * @returns the rows with the active one leading.
 */
export function rowsOf(activeRef: string, entries: SavedKeyEntries): SavedKeyRow[] {
  const listed = entriesOf(entries)
  const active = listed.find(entry => entry.ref === activeRef) ?? { ref: activeRef, label: '' }
  return [active, ...listed.filter(entry => entry.ref !== activeRef)]
}

/**
 * The list after making `ref` the active key: the key that was active stays in
 * the list, so it can be chosen again.
 * @param entries - the stored list.
 * @param previousActive - the reference that was active.
 * @returns the list to store.
 */
export function listAfterActivating(entries: SavedKeyEntries, previousActive: string): { ref: string; label: string }[] {
  const listed = entriesOf(entries)
  return listed.some(entry => entry.ref === previousActive) ? listed : [...listed, { ref: previousActive, label: '' }]
}

/**
 * A reference name for one more key of a provider that is free in both the
 * list and the active slot.
 * @param baseRef - the provider's conventional reference (e.g. `ANTHROPIC_API_KEY`).
 * @param taken - every reference already in use for this provider.
 * @returns `<baseRef>_<n>` for the smallest free `n >= 2`.
 */
export function nextRef(baseRef: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let n = 2
  while (used.has(`${baseRef}_${String(n)}`)) n += 1
  return `${baseRef}_${String(n)}`
}
