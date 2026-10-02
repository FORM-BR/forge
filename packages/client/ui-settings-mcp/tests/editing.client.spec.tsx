// @vitest-environment jsdom
import type { McpServerSummary, McpStatusSnapshot, McpWriteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpActionError, McpSettingsTab } from '../src/client/McpSettingsTab.tsx'
import type { McpSettingsTabInjected, McpSettingsTabProps } from '../src/client/McpSettingsTab.tsx'
import { buildDraft, emptyForm, formFromConfig, validateForm } from '../src/client/draft.ts'
import { en, type McpSettingsLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = ((key: McpSettingsLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    en[key],
  )) as McpSettingsTabProps['t']

const WRITABLE = { writable: true, profileFile: '~/.dsh/profiles/web/cordis.patch.yml', homeFile: '~/.dsh/cordis.patch.yml' } as const

const DOCS: McpServerSummary = {
  key: 'docs', serverName: 'docs', transport: 'stdio', state: 'connected', toolCount: 3, source: 'profile',
  config: {
    id: 'mcp-docs', disabled: false, editable: true, command: 'npx',
    args: [{ text: '-y', masked: false }, { text: '••••', masked: true }], envKeys: ['DOCS_KEY'],
  },
}
const SHARED: McpServerSummary = {
  key: 'shared', serverName: 'shared', transport: 'streamable-http', host: 'mcp.example.com', state: 'connected', toolCount: 1, source: 'home',
  config: { id: 'mcp-shared', disabled: false, editable: true, url: 'https://mcp.example.com/mcp?key=••••', urlMasked: true, headerKeys: ['Authorization'] },
}
const BUNDLED: McpServerSummary = { key: 'built', serverName: 'built', transport: 'stdio', state: 'connected', toolCount: 2 }

const APPLIED: McpWriteResult = { outcome: 'applied', id: 'mcp-docs' }

function snapshot(servers: McpServerSummary[], management: McpStatusSnapshot['management'] = WRITABLE): McpStatusSnapshot {
  return { servers, management }
}

function face(overrides: Partial<McpSettingsTabInjected> = {}, servers: McpServerSummary[] = [DOCS, SHARED, BUNDLED]) {
  const injected = {
    list: vi.fn<McpSettingsTabInjected['list']>().mockResolvedValue(snapshot(servers)),
    save: vi.fn<McpSettingsTabInjected['save']>().mockResolvedValue(APPLIED),
    setEnabled: vi.fn<McpSettingsTabInjected['setEnabled']>().mockResolvedValue(APPLIED),
    remove: vi.fn<McpSettingsTabInjected['remove']>().mockResolvedValue(APPLIED),
    openFile: vi.fn<McpSettingsTabInjected['openFile']>().mockResolvedValue(undefined),
    ...overrides,
  }
  const close = vi.fn()
  render(<McpSettingsTab {...{ t, close, ...injected } as McpSettingsTabProps} />)
  return { ...injected, close }
}

const row = (name: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${name}"]`)
  if (element === null) throw new Error(`no row for ${name}`)
  return element
}

const type = (label: string | RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('add a server', () => {
  it('validates before sending, then submits the draft and reports the outcome', async () => {
    const view = face()
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    expect(document.querySelector('[data-mcp-form="add"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect((await screen.findAllByRole('alert')).map(alert => alert.textContent)).toEqual(
      expect.arrayContaining([en.errNameRequired, en.errCommandRequired]),
    )
    expect(view.save).not.toHaveBeenCalled()

    type(en.fieldName, 'fresh')
    type(en.fieldCommand, 'node')
    fireEvent.click(screen.getByRole('button', { name: en.addArg }))
    fireEvent.change(screen.getByPlaceholderText(en.argPlaceholder), { target: { value: 'srv.js' } })
    fireEvent.click(screen.getByRole('button', { name: en.addEnv }))
    fireEvent.change(screen.getByPlaceholderText(en.pairName), { target: { value: 'TOKEN' } })
    const secret = screen.getByPlaceholderText(en.pairValue) as HTMLInputElement
    expect(secret.type).toBe('password')
    fireEvent.change(secret, { target: { value: 'brand-new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    await waitFor(() => { expect(view.save).toHaveBeenCalledOnce() })
    expect(view.save).toHaveBeenCalledWith({
      name: 'fresh', transport: 'stdio', command: 'node', args: [{ value: 'srv.js' }], env: { TOKEN: 'brand-new-secret' },
    }, undefined)
    expect((await screen.findByText(en.savedApplied)).getAttribute('data-mcp-notice')).toBe('ok')
    expect(document.querySelector('[data-mcp-form]')).toBeNull()
    await waitFor(() => { expect(vi.mocked(view.list).mock.calls.length).toBeGreaterThan(1) })
  })

  it('offers the HTTP fields, requires a valid url, and sends headers', async () => {
    const view = face()
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    fireEvent.click(screen.getByRole('tab', { name: en.transportHttpOption }))
    type(en.fieldName, 'remote')
    type(en.fieldUrl, 'ftp://nope')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText(en.errUrlInvalid)).toBeTruthy()
    type(en.fieldUrl, 'https://mcp.example.com/mcp')
    fireEvent.click(screen.getByRole('button', { name: en.addHeader }))
    fireEvent.change(screen.getByPlaceholderText(en.pairName), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByPlaceholderText(en.pairValue), { target: { value: 'Bearer abc' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view.save).toHaveBeenCalledOnce() })
    expect(view.save).toHaveBeenCalledWith({
      name: 'remote', transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer abc' },
    }, undefined)
  })

  it('keeps the form open and shows the Host message when a save is refused', async () => {
    const view = face({ save: vi.fn().mockRejectedValue(new McpActionError('another MCP server already uses this name', 'mcpStatus/invalid', 'name')) })
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    type(en.fieldName, 'docs')
    type(en.fieldCommand, 'x')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText('another MCP server already uses this name')).toBeTruthy()
    expect(document.querySelector('[data-mcp-form]')).not.toBeNull()
    expect(view.save).toHaveBeenCalledOnce()
  })

  it('reports an apply failure on the form and a restart requirement as a notice', async () => {
    const view = face({
      save: vi.fn()
        .mockRejectedValueOnce(new McpActionError('spawn node ENOENT', 'mcpStatus/apply-failed'))
        .mockResolvedValueOnce({ outcome: 'restart-required', id: 'x' }),
    })
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.addServer }))
    type(en.fieldName, 'fresh')
    type(en.fieldCommand, 'node')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText(/rolled back: spawn node ENOENT/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText(en.savedRestart)).toBeTruthy()
    expect(view.save).toHaveBeenCalledTimes(2)
  })
})

describe('edit, toggle, and remove', () => {
  it('opens a profile server with hidden values left empty and sends them back as keep', async () => {
    const view = face()
    await screen.findByText('3 servers')
    fireEvent.click(within(row('docs')).getByRole('button', { name: en.actionEdit }))
    expect(document.querySelector('[data-mcp-form="edit"]')).not.toBeNull()
    expect(screen.getAllByLabelText(en.fieldName)[0]).toHaveProperty('value', 'docs')
    expect(screen.getByLabelText(en.fieldCommand)).toHaveProperty('value', 'npx')
    const args = screen.getAllByLabelText(en.fieldArgs) as HTMLInputElement[]
    expect(args.map(input => input.value)).toEqual(['-y', ''])
    expect(args[1]?.placeholder).toBe(en.argMaskedPlaceholder)
    expect(screen.getByDisplayValue('DOCS_KEY')).toBeTruthy()
    expect(screen.getByPlaceholderText(en.pairValueStored)).toHaveProperty('value', '')

    type(en.fieldCommand, 'node')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(view.save).toHaveBeenCalledOnce() })
    expect(view.save).toHaveBeenCalledWith({
      name: 'docs', transport: 'stdio', command: 'node', args: [{ keep: 0 }, { keep: 1 }], env: { DOCS_KEY: null },
    }, 'mcp-docs')
  })

  it('keeps a masked url when untouched and replaces it when typed over', () => {
    const form = formFromConfig(SHARED, SHARED.config!)
    expect(buildDraft(form)).toEqual({ name: 'shared', transport: 'streamable-http', url: null, headers: { Authorization: null } })
    expect(buildDraft({ ...form, url: 'https://other.example.com/x', urlEdited: true })).toMatchObject({ url: 'https://other.example.com/x' })
    expect(validateForm({ ...form, url: '', urlEdited: true })).toEqual([{ field: 'url', code: 'urlRequired' }])
  })

  it('switches a server off and on from its row', async () => {
    const view = face()
    await screen.findByText('3 servers')
    fireEvent.click(within(row('docs')).getByRole('switch', { name: 'Enable docs' }))
    await waitFor(() => { expect(view.setEnabled).toHaveBeenCalledWith('mcp-docs', false) })
    expect(await screen.findByText(en.savedApplied)).toBeTruthy()
  })

  it('asks before removing and removes on confirmation only', async () => {
    const view = face()
    await screen.findByText('3 servers')
    fireEvent.click(within(row('docs')).getByRole('button', { name: en.actionRemove }))
    fireEvent.click(within(row('docs')).getByRole('button', { name: en.cancel }))
    expect(view.remove).not.toHaveBeenCalled()
    fireEvent.click(within(row('docs')).getByRole('button', { name: en.actionRemove }))
    expect(within(row('docs')).getByText('Remove docs from the configuration?')).toBeTruthy()
    fireEvent.click(within(row('docs')).getByRole('button', { name: en.confirmRemoveYes }))
    await waitFor(() => { expect(view.remove).toHaveBeenCalledWith('mcp-docs') })
  })

  it('reports a failed toggle without losing the list', async () => {
    face({ setEnabled: vi.fn().mockRejectedValue(new McpActionError('gone', 'mcpStatus/not-found')) })
    await screen.findByText('3 servers')
    fireEvent.click(within(row('docs')).getByRole('switch', { name: 'Enable docs' }))
    expect((await screen.findByText(en.notFoundFailure)).getAttribute('data-mcp-notice')).toBe('error')
    expect(row('docs')).toBeTruthy()
  })

  it('disables Edit for a definition the form cannot represent', async () => {
    face({}, [{ ...DOCS, config: { ...DOCS.config!, editable: false } }])
    await screen.findByText('1 server')
    const edit = within(row('docs')).getByRole('button', { name: en.actionEdit }) as HTMLButtonElement
    expect(edit.disabled).toBe(true)
    expect(edit.title).toBe(en.notEditable)
  })
})

describe('where a server is defined', () => {
  it('shows home and bundle servers read-only with a way to open the home file', async () => {
    const view = face()
    await screen.findByText('3 servers')
    const shared = within(row('shared'))
    expect(shared.getByText('Defined in ~/.dsh/cordis.patch.yml. Edit that file to change it.')).toBeTruthy()
    expect(shared.queryByRole('button', { name: en.actionEdit })).toBeNull()
    expect(shared.queryByRole('switch')).toBeNull()
    fireEvent.click(shared.getByRole('button', { name: en.openHomeFile }))
    expect(view.openFile).toHaveBeenCalledWith('home')
    expect(within(row('built')).getByText(en.sourceOther)).toBeTruthy()
  })

  it('opens the profile file from the toolbar and reports a failure to open', async () => {
    const view = face({ openFile: vi.fn().mockRejectedValue(new McpActionError('no editor', 'gateway/internal')) })
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.openFileLabel }))
    expect(view.openFile).toHaveBeenCalledWith('profile')
    expect(await screen.findByText('Could not complete the action: no editor')).toBeTruthy()
  })

  it('hides every write control when the profile is read-only and says why', async () => {
    face({ list: vi.fn().mockResolvedValue(snapshot([DOCS], { writable: false, readOnlyReason: 'safe-mode' })) })
    await screen.findByText('1 server')
    expect(screen.queryByRole('button', { name: en.addServer })).toBeNull()
    expect(within(row('docs')).queryByRole('switch')).toBeNull()
    expect(document.querySelector('[data-mcp-read-only]')?.textContent).toBe(en.readOnlySafeMode)
  })

  it('marks a saved server that is waiting for a restart', async () => {
    face({}, [{ ...DOCS, state: 'connecting', toolCount: 0, pendingRestart: true }])
    await screen.findByText('1 server')
    expect(row('docs').querySelector('[data-mcp-pending-restart]')?.textContent).toBe(en.pendingRestart)
  })
})

describe('ask the agent', () => {
  it('starts the assistant session and closes settings', async () => {
    const start = vi.fn()
    const view = face({ askAgent: { available: true, start } })
    await screen.findByText('3 servers')
    fireEvent.click(screen.getByRole('button', { name: en.askAgent }))
    expect(start).toHaveBeenCalledOnce()
    expect(view.close).toHaveBeenCalledOnce()
  })

  it('stays disabled with the reason while Developer tools are off, and is absent without a launcher', async () => {
    const start = vi.fn()
    face({ askAgent: { available: false, start } })
    await screen.findByText('3 servers')
    const button = screen.getByRole('button', { name: en.askAgent }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe(en.askAgentNeedsDevTools)
    cleanup()
    face()
    await screen.findByText('3 servers')
    expect(screen.queryByRole('button', { name: en.askAgent })).toBeNull()
  })
})

describe('form model', () => {
  it('builds a stdio draft from a blank form and refuses a bad name or env name', () => {
    const form = { ...emptyForm(), name: 'ok_name', command: ' node ', env: [{ key: 1, name: 'A_B', value: 'v' }] }
    expect(validateForm(form)).toEqual([])
    expect(buildDraft(form)).toEqual({ name: 'ok_name', transport: 'stdio', command: 'node', args: [], env: { A_B: 'v' } })
    expect(validateForm({ ...form, name: 'bad name', env: [{ key: 1, name: '1X', value: '' }] }).map(problem => problem.code))
      .toEqual(['nameInvalid', 'pairNameInvalid'])
  })

  it('does not keep a stored value under a renamed key and skips blank rows', () => {
    const form = {
      ...formFromConfig(DOCS, DOCS.config!),
      env: [
        { key: 1, name: 'RENAMED', storedName: 'DOCS_KEY', value: '' },
        { key: 2, name: '  ', value: 'ignored' },
      ],
    }
    expect(buildDraft(form)).toMatchObject({ env: { RENAMED: '' } })
  })

  it('lets a typed value replace a hidden argument', () => {
    const form = formFromConfig(DOCS, DOCS.config!)
    const edited = { ...form, args: form.args.map((arg, index) => index === 1 ? { ...arg, text: 'new', edited: true } : arg) }
    expect(buildDraft(edited)).toMatchObject({ args: [{ keep: 0 }, { value: 'new' }] })
  })
})

describe('background refresh', () => {
  it('does not poll when everything is settled', async () => {
    vi.useFakeTimers()
    const view = face()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(view.list).toHaveBeenCalledTimes(1)
  })
})
