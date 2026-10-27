import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  McpServerDraft, McpServerHalt, McpServerState, McpServerSummary, McpStatusSnapshot, McpWriteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconEditOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, IconTrashOutlineRegular, StateDot, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { McpActionError } from './actions.ts'
import { emptyForm, formFromConfig, type FormField, type FormModel } from './draft.ts'
import type { McpSettingsLocaleKey } from './locales.ts'
import { McpServerForm } from './McpServerForm.tsx'
import css from './McpSettingsTab.module.css'

export { McpActionError } from './actions.ts'

/** Registration-side Remote face used by the tab. */
export interface McpSettingsTabInjected {
  /** Read a current Host snapshot of every configured MCP server. */
  list: () => Promise<McpStatusSnapshot>
  /** Add a server (`id` absent) or replace the form-owned fields of one; rejects with {@link McpActionError}. */
  save: (draft: McpServerDraft, id: string | undefined) => Promise<McpWriteResult>
  /** Switch one profile server on or off; rejects with {@link McpActionError}. */
  setEnabled: (id: string, enabled: boolean) => Promise<McpWriteResult>
  /** Delete one profile server; rejects with {@link McpActionError}. */
  remove: (id: string) => Promise<McpWriteResult>
  /** Open the profile patch or the user-wide patch in a text editor; rejects with {@link McpActionError}. */
  openFile: (which: 'profile' | 'home') => Promise<void>
  /** Start a session with the MCP assistant; absent while no conversation flow exists. */
  askAgent?: { readonly available: boolean; readonly start: () => void }
}

/** Full component props assembled by the Settings slot renderer. */
export type McpSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSettingsTabInjected>

type Translate = McpSettingsTabProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: McpStatusSnapshot }

/** Delay between background reads while some server is still connecting or retrying. */
export const UNSETTLED_REFRESH_MS = 3000

/** Smallest working entry, shown when no server is configured. */
const EXAMPLE_ENTRY = `- insert:
    - id: mcp-docs
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: docs
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-everything']`

const STATE_KEYS = {
  connecting: 'stateConnecting',
  connected: 'stateConnected',
  error: 'stateError',
  disabled: 'stateDisabled',
} satisfies Record<McpServerState, McpSettingsLocaleKey>

const STATE_DOTS = {
  connecting: 'ongoing',
  connected: 'done',
  error: 'error',
  disabled: 'idle',
} as const satisfies Record<McpServerState, StateDotState>

const STATE_TONES = {
  connecting: 'info',
  connected: 'success',
  error: 'danger',
  disabled: 'neutral',
} as const satisfies Record<McpServerState, TagTone>

const HALT_KEYS = {
  'reconnect-disabled': 'haltReconnectDisabled',
  'attempts-exhausted': 'haltAttemptsExhausted',
  'transport-unconfirmed': 'haltTransportUnconfirmed',
  'load-failed': 'haltLoadFailed',
} satisfies Record<McpServerHalt, McpSettingsLocaleKey>

const OUTCOME_KEYS = {
  applied: 'savedApplied',
  pending: 'savedPending',
  'restart-required': 'savedRestart',
} as const satisfies Record<McpWriteResult['outcome'], McpSettingsLocaleKey>

const FORM_FIELDS: readonly string[] = ['name', 'command', 'url', 'args', 'env', 'headers', 'transport'] satisfies FormField[]

/** Whether another read is likely to show a different state without user action. */
function isUnsettled(snapshot: McpStatusSnapshot): boolean {
  return snapshot.servers.some(server =>
    server.state === 'connecting' || (server.state === 'error' && server.retry !== undefined))
}

/** Transport tag text, with the endpoint host for Streamable HTTP. */
function transportText(server: McpServerSummary, t: Translate): string | undefined {
  if (server.transport === null) return undefined
  if (server.transport === 'stdio') return t('transportStdio')
  return server.host === undefined ? t('transportHttp') : `${t('transportHttp')} · ${server.host}`
}

/** User-facing text of a failed write. */
function failureText(error: unknown, t: Translate): string {
  if (error instanceof McpActionError) {
    if (error.code === 'mcpStatus/not-found') return t('notFoundFailure')
    if (error.code === 'mcpStatus/read-only') return t('readOnlyFailure')
    if (error.code === 'mcpStatus/apply-failed') return t('applyFailure', { reason: error.message })
    return t('actionFailed', { reason: error.message })
  }
  return t('actionFailed', { reason: error instanceof Error ? error.message : String(error) })
}

interface RowActions {
  readonly writable: boolean
  readonly homeFile: string | undefined
  readonly busy: boolean
  readonly confirming: boolean
  readonly onToggle: (server: McpServerSummary, enabled: boolean) => void
  readonly onEdit: (server: McpServerSummary) => void
  readonly onAskRemove: (server: McpServerSummary) => void
  readonly onConfirmRemove: (server: McpServerSummary) => void
  readonly onCancelRemove: () => void
  readonly onOpenHome: () => void
}

interface RowProps {
  readonly server: McpServerSummary
  readonly actions: RowActions
  readonly t: Translate
}

/** What a row offers: edit controls for a profile definition, otherwise where it lives. */
function RowControls({ server, actions, t }: RowProps): ReactNode {
  const config = server.config
  if (server.source === 'profile' && config !== undefined && actions.writable) {
    if (actions.confirming) {
      return (
        <div className={css.controls} role="group" aria-label={t('confirmRemove', { name: server.serverName })}>
          <span className={css.hint}>{t('confirmRemove', { name: server.serverName })}</span>
          <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => { actions.onConfirmRemove(server) }}>{t('confirmRemoveYes')}</Button>
          <Button size="sm" variant="ghost" disabled={actions.busy} onClick={actions.onCancelRemove}>{t('cancel')}</Button>
        </div>
      )
    }
    return (
      <div className={css.controls}>
        <Switch
          checked={!config.disabled}
          label={t('toggleLabel', { name: server.serverName })}
          disabled={actions.busy}
          onChange={(next) => { actions.onToggle(server, next) }}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<IconEditOutlineRegular size={14} aria-hidden="true" />}
          disabled={actions.busy || !config.editable}
          title={config.editable ? undefined : t('notEditable')}
          onClick={() => { actions.onEdit(server) }}
        >
          {t('actionEdit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconTrashOutlineRegular size={14} aria-hidden="true" />}
          disabled={actions.busy}
          onClick={() => { actions.onAskRemove(server) }}
        >
          {t('actionRemove')}
        </Button>
      </div>
    )
  }
  if (server.source === 'home') {
    return (
      <div className={css.controls}>
        <span className={css.hint} data-mcp-source="home">{t('sourceHome', { file: actions.homeFile ?? '~/.dsh/cordis.patch.yml' })}</span>
        <Button size="sm" variant="outline" onClick={actions.onOpenHome}>{t('openHomeFile')}</Button>
      </div>
    )
  }
  if (server.source === undefined) return <p className={css.hint} data-mcp-source="other">{t('sourceOther')}</p>
  return null
}

/** One server row: identity, state badge, tool count, controls, then the failure detail when there is one. */
function ServerRow({ server, actions, t }: RowProps): ReactNode {
  const state = t(STATE_KEYS[server.state])
  const transport = transportText(server, t)
  const tools = t(server.toolCount === 1 ? 'toolsOne' : 'toolsMany', { count: String(server.toolCount) })
  return (
    <li className={css.row} data-mcp-server={server.serverName} data-state={server.state}>
      <div className={css.rowMain}>
        <strong className={css.name} title={server.serverName}>{server.serverName}</strong>
        <span className={css.badges}>
          {transport === undefined ? null : <Tag tone="outline">{transport}</Tag>}
          <Tag tone="quiet">{tools}</Tag>
        </span>
        <span className={css.state}>
          <span className={css.dot} role="img" aria-label={state}><StateDot state={STATE_DOTS[server.state]} /></span>
          <Tag tone={STATE_TONES[server.state]}>{state}</Tag>
        </span>
      </div>
      {server.error === undefined ? null : (
        <p className={css.errorNote} role="status" data-mcp-error>
          <span className={css.errorLabel}>{t('lastError')}</span> {server.error}
        </p>
      )}
      {server.retry === undefined ? null : (
        <p className={css.hint} data-mcp-retry>
          {t('retrying', { attempt: String(server.retry.attempt), max: String(server.retry.maxAttempts) })}
        </p>
      )}
      {server.halted === undefined ? null : <p className={css.hint} data-mcp-halted>{t(HALT_KEYS[server.halted])}</p>}
      {server.state === 'disabled' ? <p className={css.hint}>{t('disabledHint')}</p> : null}
      {server.pendingRestart === true ? <p className={css.hint} data-mcp-pending-restart>{t('pendingRestart')}</p> : null}
      <RowControls server={server} actions={actions} t={t} />
    </li>
  )
}

/** Render the MCP server list of the Plugins settings section, with add, edit, toggle, and remove for profile servers. */
export function McpSettingsTab({ list, save, setEnabled, remove, openFile, askAgent, close, t }: McpSettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [editing, setEditing] = useState<FormModel | undefined>()
  const [saving, setSaving] = useState(false)
  const [formFailure, setFormFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>()
  const [busyId, setBusyId] = useState<string | undefined>()
  const [confirmId, setConfirmId] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | undefined>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  // A connecting or retrying server settles on its own: keep reading quietly until none is left.
  const unsettled = state.status === 'ready' && isUnsettled(state.snapshot)
  useEffect(() => {
    if (!unsettled) return
    const timer = setTimeout(() => { setRequest(value => value + 1) }, UNSETTLED_REFRESH_MS)
    return () => { clearTimeout(timer) }
  }, [unsettled, state])

  const refresh = (): void => { setRequest(value => value + 1) }
  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }
  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const servers = snapshot?.servers ?? []
  const management = snapshot?.management
  const writable = management?.writable === true

  const report = (error: unknown): void => { setNotice({ tone: 'error', text: failureText(error, t) }) }

  const runWrite = async (id: string, action: () => Promise<McpWriteResult>): Promise<void> => {
    setBusyId(id)
    setNotice(undefined)
    try {
      const result = await action()
      if (mounted.current) setNotice({ tone: 'ok', text: t(OUTCOME_KEYS[result.outcome]) })
    } catch (error) {
      if (mounted.current) report(error)
    } finally {
      if (mounted.current) {
        setBusyId(undefined)
        setConfirmId(undefined)
        refresh()
      }
    }
  }

  const submit = async (draft: McpServerDraft, id: string | undefined): Promise<void> => {
    setSaving(true)
    setFormFailure(undefined)
    setNotice(undefined)
    try {
      const result = await save(draft, id)
      if (!mounted.current) return
      setEditing(undefined)
      setNotice({ tone: 'ok', text: t(OUTCOME_KEYS[result.outcome]) })
      refresh()
    } catch (error) {
      if (!mounted.current) return
      const named = error instanceof McpActionError ? error.field : undefined
      const field = named !== undefined && FORM_FIELDS.includes(named) ? named : undefined
      setFormFailure({
        message: error instanceof McpActionError && error.code === 'mcpStatus/invalid' ? error.message : failureText(error, t),
        ...field === undefined ? {} : { field },
      })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const open = (which: 'profile' | 'home'): void => {
    void openFile(which).catch((error: unknown) => { if (mounted.current) report(error) })
  }

  const actions: RowActions = {
    writable,
    homeFile: management?.homeFile,
    busy: busyId !== undefined || saving,
    confirming: false,
    onToggle: (server, enabled) => {
      const id = server.config?.id
      if (id !== undefined) void runWrite(id, () => setEnabled(id, enabled))
    },
    onEdit: (server) => {
      if (server.config === undefined) return
      setFormFailure(undefined)
      setNotice(undefined)
      setEditing(formFromConfig(server, server.config))
    },
    onAskRemove: (server) => { setConfirmId(server.config?.id) },
    onConfirmRemove: (server) => {
      const id = server.config?.id
      if (id !== undefined) void runWrite(id, () => remove(id))
    },
    onCancelRemove: () => { setConfirmId(undefined) },
    onOpenHome: () => { open('home') },
  }

  const startAdd = (): void => {
    setFormFailure(undefined)
    setNotice(undefined)
    setEditing(emptyForm())
  }

  const toolbar = state.status === 'ready' ? (
    <div className={css.toolbar}>
      <span className={css.status} data-mcp-count={servers.length}>
        {servers.length === 0 ? '' : t(servers.length === 1 ? 'summaryOne' : 'summary', { count: String(servers.length) })}
      </span>
      <span className={css.toolbarActions}>
        {writable ? (
          <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={14} aria-hidden="true" />} disabled={editing !== undefined} onClick={startAdd}>
            {t('addServer')}
          </Button>
        ) : null}
        {askAgent === undefined ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={!askAgent.available}
            title={askAgent.available ? t('askAgentHint') : t('askAgentNeedsDevTools')}
            onClick={() => { askAgent.start(); close() }}
          >
            {t('askAgent')}
          </Button>
        )}
        {management?.profileFile === undefined ? null : (
          <Button size="sm" variant="outline" aria-label={t('openFileLabel')} title={management.profileFile} onClick={() => { open('profile') }}>
            {t('openFile')}
          </Button>
        )}
        <button type="button" className={css.refresh} aria-label={t('refreshLabel')} onClick={refresh}>
          <IconRefreshOutlineRegular size={14} aria-hidden="true" />{t('refresh')}
        </button>
      </span>
    </div>
  ) : null

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? (
        <p className={`${css.status} ${css.statusWithDot}`} role="status">
          <StateDot state="ongoing" />{t('loading')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p className={css.statusWithDot} role="alert">
            <StateDot state="error" />{t('error')}
          </p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {toolbar}
      {management !== undefined && !management.writable && management.readOnlyReason !== undefined ? (
        <p className={css.hint} data-mcp-read-only>{t(management.readOnlyReason === 'safe-mode' ? 'readOnlySafeMode' : 'readOnlyNoProfile')}</p>
      ) : null}
      {notice === undefined ? null : (
        <p className={notice.tone === 'ok' ? css.notice : css.errorNote} role="status" data-mcp-notice={notice.tone}>{notice.text}</p>
      )}
      {editing === undefined ? null : (
        <McpServerForm
          key={editing.id ?? 'new'}
          initial={editing}
          t={t}
          busy={saving}
          failure={formFailure}
          onSave={(draft, id) => { void submit(draft, id) }}
          onCancel={() => { setEditing(undefined); setFormFailure(undefined) }}
        />
      )}
      {state.status === 'ready' && servers.length === 0 ? (
        <div className={css.empty} data-mcp-empty>
          <p className={css.emptyTitle}>{t('emptyTitle')}</p>
          <p className={css.status}>{t(writable ? 'emptyBody' : 'emptyBodyReadOnly')}</p>
          <pre className={css.code}>{EXAMPLE_ENTRY}</pre>
        </div>
      ) : null}
      {state.status === 'ready' && servers.length > 0 ? (
        <ul className={css.list}>
          {servers.map(server => (
            <ServerRow
              key={server.key}
              server={server}
              t={t}
              actions={{ ...actions, confirming: server.config !== undefined && confirmId === server.config.id }}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
