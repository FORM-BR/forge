// @vitest-environment jsdom
/** Several API keys per provider: the pure bookkeeping, the list card, and the editor that applies them. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import type { CredentialBalance, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { SavedKeys } from '../src/client/SavedKeys.tsx'
import type { SavedKeysProps } from '../src/client/SavedKeys.tsx'
import { entriesOf, listAfterActivating, nextRef, rowsOf } from '../src/client/saved-keys.ts'
import { createModelsOperations } from '../src/client/operations.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: SavedKeysProps['t'] = key => en[key]

describe('saved-keys bookkeeping', () => {
  it('keeps only well-formed, distinct entries of a stored list', () => {
    expect(entriesOf(undefined)).toEqual([])
    expect(entriesOf('nope')).toEqual([])
    expect(entriesOf([
      null,
      'text',
      { ref: 7 },
      { ref: 'not a var' },
      { ref: 'KEY_A', label: 'A' },
      { ref: 'KEY_A', label: 'again' },
      { ref: 'KEY_B' },
      { ref: 'KEY_C', label: 3 },
    ])).toEqual([
      { ref: 'KEY_A', label: 'A' },
      { ref: 'KEY_B', label: '' },
      { ref: 'KEY_C', label: '' },
    ])
  })

  it('leads the rows with the active reference, listed or not', () => {
    const entries = [{ ref: 'KEY_A', label: 'A' }, { ref: 'KEY_B', label: 'B' }]
    expect(rowsOf('KEY_B', entries)).toEqual([{ ref: 'KEY_B', label: 'B' }, { ref: 'KEY_A', label: 'A' }])
    expect(rowsOf('MAIN', entries)).toEqual([
      { ref: 'MAIN', label: '' }, { ref: 'KEY_A', label: 'A' }, { ref: 'KEY_B', label: 'B' },
    ])
  })

  it('keeps the previously active key in the list when another is activated', () => {
    expect(listAfterActivating([{ ref: 'KEY_A', label: 'A' }], 'MAIN'))
      .toEqual([{ ref: 'KEY_A', label: 'A' }, { ref: 'MAIN', label: '' }])
    expect(listAfterActivating([{ ref: 'MAIN', label: 'Main' }], 'MAIN')).toEqual([{ ref: 'MAIN', label: 'Main' }])
  })

  it('names the next free reference after the conventional one', () => {
    expect(nextRef('ANTHROPIC_API_KEY', ['ANTHROPIC_API_KEY'])).toBe('ANTHROPIC_API_KEY_2')
    expect(nextRef('ANTHROPIC_API_KEY', ['ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3'])).toBe('ANTHROPIC_API_KEY_4')
  })
})

function cardProps(overrides: Partial<SavedKeysProps> = {}): SavedKeysProps {
  return {
    t,
    provider: 'openrouter',
    rows: [{ ref: 'MAIN', label: '' }, { ref: 'KEY_2', label: 'Work' }],
    unsaved: new Set(),
    disabled: false,
    onActivate: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onBalance: vi.fn(() => Promise.resolve<CredentialBalance | undefined>({ status: 'ok', amount: '9.50', currency: 'USD' })),
    ...overrides,
  }
}

describe('the saved-keys card', () => {
  it('shows the active key first and names an unnamed row by its role or reference', () => {
    render(<SavedKeys {...cardProps({ rows: [
      { ref: 'MAIN', label: '' }, { ref: 'KEY_2', label: '' }, { ref: 'KEY_3', label: 'Work' },
    ] })} />)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.keyUse} ${en.keyMain}`).checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.keyUse} KEY_2`).checked).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.keyUse} Work`).checked).toBe(false)
    expect(screen.getByText(en.keyActive)).toBeTruthy()
    expect(screen.queryByLabelText(`${en.keyRemove} ${en.keyMain}`)).toBeNull()
  })

  it('activates and removes a non-active key', () => {
    const props = cardProps()
    render(<SavedKeys {...props} />)
    fireEvent.click(screen.getByLabelText(`${en.keyUse} Work`))
    expect(props.onActivate).toHaveBeenCalledWith('KEY_2')
    fireEvent.click(screen.getByLabelText(`${en.keyRemove} Work`))
    expect(props.onRemove).toHaveBeenCalledWith('KEY_2')
  })

  it('adds a trimmed key under a trimmed name, then clears the form', () => {
    const props = cardProps()
    render(<SavedKeys {...props} />)
    const add = screen.getByText<HTMLButtonElement>(en.keyAdd)
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(en.keyLabel), { target: { value: '  Personal ' } })
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: '  sk-new  ' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(props.onAdd).toHaveBeenCalledWith('Personal', 'sk-new')
    expect(screen.getByLabelText<HTMLInputElement>(en.keyLabel).value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>(en.keyNewValue).value).toBe('')
  })

  it('refuses a key with illegal characters and says why', () => {
    render(<SavedKeys {...cardProps()} />)
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: 'sk-\u{1F600}' } })
    expect(screen.getByText(en.keyIllegalCharacters)).toBeTruthy()
    expect(screen.getByText<HTMLButtonElement>(en.keyAdd).disabled).toBe(true)
  })

  it('locks every control while the card is disabled', () => {
    render(<SavedKeys {...cardProps({ disabled: true })} />)
    expect(screen.getByLabelText<HTMLInputElement>(en.keyLabel).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(en.keyNewValue).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.keyUse} Work`).disabled).toBe(true)
    for (const button of screen.getAllByText<HTMLButtonElement>(en.balanceCheck)) expect(button.disabled).toBe(true)
  })

  it('asks for the balance of one row and shows the amount while the others wait', async () => {
    let answer: (value: CredentialBalance) => void = () => undefined
    const props = cardProps({ onBalance: vi.fn(() => new Promise<CredentialBalance>((resolve) => { answer = resolve })) })
    render(<SavedKeys {...props} />)
    const [first, second] = screen.getAllByText<HTMLButtonElement>(en.balanceCheck)
    fireEvent.click(first as HTMLButtonElement)
    expect(props.onBalance).toHaveBeenCalledWith('MAIN')
    expect(screen.getByText(en.balanceChecking)).toBeTruthy()
    expect(second?.disabled).toBe(true)
    answer({ status: 'ok', amount: '9.50', currency: 'USD' })
    await waitFor(() => { expect(screen.getByText(`${en.balanceLabel}: 9.50 USD`)).toBeTruthy() })
    expect(screen.getAllByText<HTMLButtonElement>(en.balanceCheck)[1]?.disabled).toBe(false)
  })

  it('words each outcome a provider can answer', async () => {
    const outcomes: [CredentialBalance | undefined, string][] = [
      [{ status: 'ok', amount: '1.00' }, `${en.balanceLabel}: 1.00`],
      [{ status: 'ok' }, `${en.balanceLabel}:`],
      [{ status: 'unsupported' }, en.balanceUnsupported],
      [{ status: 'unconfigured' }, en.balanceUnconfigured],
      [{ status: 'failed' }, en.balanceFailed],
      [{ status: 'failed', detail: 'HTTP 401' }, `${en.balanceFailed} (HTTP 401)`],
      [undefined, en.balanceFailed],
    ]
    for (const [outcome, text] of outcomes) {
      render(<SavedKeys {...cardProps({ onBalance: () => Promise.resolve(outcome) })} />)
      fireEvent.click(screen.getAllByText(en.balanceCheck)[0] as HTMLElement)
      await waitFor(() => { expect(screen.getByText(text)).toBeTruthy() })
      cleanup()
    }
  })

  it('holds the balance question for a key that is only pending in the draft', () => {
    render(<SavedKeys {...cardProps({ unsaved: new Set(['KEY_2']) })} />)
    const buttons = screen.getAllByText<HTMLButtonElement>(en.balanceCheck)
    expect(buttons[0]?.disabled).toBe(false)
    expect(buttons[1]?.disabled).toBe(true)
    expect(buttons[1]?.title).toBe(en.balanceSaveFirst)
  })
})

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    apiKeys: Schema.array(Schema.object({
      ref: Schema.string().role('credential-ref').required(),
      label: Schema.string(),
    })),
    baseURL: Schema.string(),
  })),
})

function namespaceOf(profile: Record<string, JsonValue>): SettingsNamespaceView {
  const providers = { anthropic: profile }
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers },
    base: { providers: {} },
    user: { providers },
    autoGenerate: true,
    applies: 'live',
    secrets: [],
    revision: 3,
  }
}

function fakeOperations(overrides: Partial<ModelsOperations> = {}) {
  const operations = {
    describeCredential: vi.fn(() => Promise.resolve({ configured: true, writable: true })),
    storeCredential: vi.fn(() => Promise.resolve(undefined)),
    removeCredential: vi.fn(() => Promise.resolve(undefined)),
    checkBalance: vi.fn(() => Promise.resolve<CredentialBalance | undefined>({ status: 'unsupported' })),
    writeSettings: vi.fn((_ns: string, _ops: unknown, _revision: number | undefined) =>
      Promise.resolve({ kind: 'written' as const, view: namespaceOf({}) })),
    discoverModels: vi.fn(() => Promise.resolve({ kind: 'found' as const, models: [] })),
    ...overrides,
  }
  return operations as typeof operations & ModelsOperations
}

function mountEditor(profile: Record<string, JsonValue>, operations: ModelsOperations, extra: { readOnly?: boolean } = {}) {
  const onClose = vi.fn()
  render(<ProviderEditor
    provider="anthropic"
    displayName="Anthropic"
    namespace={namespaceOf(profile)}
    schema={settingsSchema}
    settingsPath={['providers', 'anthropic']}
    operations={operations}
    t={t}
    readOnly={extra.readOnly ?? false}
    onClose={onClose}
  />)
  return onClose
}

type SettingsOps = { op: string; path: string[]; value?: unknown }[]
function writtenOps(operations: ReturnType<typeof fakeOperations>): SettingsOps {
  const write = operations.writeSettings as unknown as ReturnType<typeof vi.fn>
  const call = write.mock.calls[0] as [string, SettingsOps, number | undefined] | undefined
  if (call === undefined) throw new Error('no settings write was recorded')
  return call[1]
}

describe('several keys for one provider, applied from the editor card', () => {
  it('adds a key: stores it under the next reference and lists it, only on Apply', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({ apiKeyEnv: 'ANTHROPIC_API_KEY' }, operations)
    fireEvent.change(screen.getByLabelText(en.keyLabel), { target: { value: 'Work' } })
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: 'sk-ant-work' } })
    fireEvent.click(screen.getByText(en.keyAdd))
    expect(screen.getByLabelText(`${en.keyUse} Work`)).toBeTruthy()
    expect(operations.storeCredential).not.toHaveBeenCalled()
    expect(screen.getByText<HTMLButtonElement>(en.balanceCheck, { selector: 'button[title]' }).disabled).toBe(true)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writtenOps(operations)).toEqual([
      { op: 'set', path: ['providers', 'anthropic', 'apiKeys'], value: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }] },
    ])
    expect(operations.storeCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY_2', 'sk-ant-work')
  })

  it('numbers a further key after the ones already saved', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }],
    }, operations)
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: 'sk-ant-third' } })
    fireEvent.click(screen.getByText(en.keyAdd))
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(operations.storeCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY_3', 'sk-ant-third')
  })

  it('makes another key the active one and keeps the previous key selectable', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }],
    }, operations)
    fireEvent.click(screen.getByLabelText(`${en.keyUse} Work`))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.keyUse} Work`).checked).toBe(true)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writtenOps(operations)).toEqual([
      { op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY_2' },
      { op: 'set', path: ['providers', 'anthropic', 'apiKeys'], value: [
        { ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }, { ref: 'ANTHROPIC_API_KEY', label: '' },
      ] },
    ])
  })

  it('activates from the derived reference when the profile names none', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({ apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }] }, operations)
    fireEvent.click(screen.getByLabelText(`${en.keyUse} Work`))
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(writtenOps(operations)).toContainEqual(
      { op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY_2' })
  })

  it('removes a stored key by unsetting its credential on Apply', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }],
    }, operations)
    fireEvent.click(screen.getByLabelText(`${en.keyRemove} Work`))
    expect(screen.queryByLabelText(`${en.keyUse} Work`)).toBeNull()
    expect(operations.removeCredential).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(operations.removeCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY_2')
  })

  it('drops a key added and removed in the same session without ever storing it', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({ apiKeyEnv: 'ANTHROPIC_API_KEY' }, operations)
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: 'sk-ant-temp' } })
    fireEvent.click(screen.getByText(en.keyAdd))
    fireEvent.click(screen.getByLabelText(`${en.keyRemove} ANTHROPIC_API_KEY_2`))
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(operations.storeCredential).not.toHaveBeenCalled()
    expect(operations.removeCredential).not.toHaveBeenCalled()
  })

  it('replaces the value of the key chosen as active when a key is typed', async () => {
    const operations = fakeOperations()
    const onClose = mountEditor({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }],
    }, operations)
    fireEvent.click(screen.getByLabelText(`${en.keyUse} Work`))
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-ant-rotated' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(operations.storeCredential).toHaveBeenCalledWith('ANTHROPIC_API_KEY_2', 'sk-ant-rotated')
  })

  it('reports a refused store of a new key and a refused removal, and stays open', async () => {
    const operations = fakeOperations({
      storeCredential: vi.fn(() => Promise.resolve('a read-only source shadows this reference')),
    })
    const onClose = mountEditor({ apiKeyEnv: 'ANTHROPIC_API_KEY' }, operations)
    fireEvent.change(screen.getByLabelText(en.keyNewValue), { target: { value: 'sk-ant-work' } })
    fireEvent.click(screen.getByText(en.keyAdd))
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(screen.getByText('a read-only source shadows this reference')).toBeTruthy() })
    expect(onClose).not.toHaveBeenCalled()
    cleanup()

    const removal = fakeOperations({ removeCredential: vi.fn(() => Promise.resolve('cannot remove')) })
    const closed = mountEditor({
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      apiKeys: [{ ref: 'ANTHROPIC_API_KEY_2', label: 'Work' }],
    }, removal)
    fireEvent.click(screen.getByLabelText(`${en.keyRemove} Work`))
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(screen.getByText('cannot remove')).toBeTruthy() })
    expect(closed).not.toHaveBeenCalled()
  })

  it('asks the Host for the balance of a stored key through the card', async () => {
    const operations = fakeOperations({
      checkBalance: vi.fn(() => Promise.resolve<CredentialBalance | undefined>({ status: 'unsupported' })),
    })
    mountEditor({ apiKeyEnv: 'ANTHROPIC_API_KEY' }, operations)
    fireEvent.click(screen.getByText(en.balanceCheck))
    await waitFor(() => { expect(screen.getByText(en.balanceUnsupported)).toBeTruthy() })
    expect(operations.checkBalance).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'anthropic')
  })

  it('locks the list while the settings are read-only', () => {
    mountEditor({ apiKeyEnv: 'ANTHROPIC_API_KEY' }, fakeOperations(), { readOnly: true })
    expect(screen.getByLabelText<HTMLInputElement>(en.keyNewValue).disabled).toBe(true)
  })
})

describe('the Host operation behind the balance button', () => {
  it('relays the Host outcome and reports a refused question as no outcome', async () => {
    const balance = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { status: 'ok', amount: '1.00', currency: 'USD' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'down' } })
    const ctx = Object.assign(new Context(), { remote: { credentials: { balance } } })
    const operations = createModelsOperations(ctx as never)
    expect(await operations.checkBalance('OPENROUTER_API_KEY', 'openrouter'))
      .toEqual({ status: 'ok', amount: '1.00', currency: 'USD' })
    expect(await operations.checkBalance('OPENROUTER_API_KEY', 'openrouter')).toBeUndefined()
    expect(balance).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'openrouter')
  })
})
