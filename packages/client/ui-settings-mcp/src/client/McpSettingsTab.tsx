import { useEffect, useState, type ReactNode } from 'react'
import type { McpServerHalt, McpServerState, McpServerSummary, McpStatusSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconRefreshOutlineRegular, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpSettingsLocaleKey } from './locales.ts'
import css from './McpSettingsTab.module.css'

/** Registration-side Remote face used by the tab. */
export interface McpSettingsTabInjected {
  /** Read a current Host snapshot of every configured MCP server. */
  list: () => Promise<McpStatusSnapshot>
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

/** One server row: identity, state badge, tool count, then the failure detail when there is one. */
function ServerRow({ server, t }: { readonly server: McpServerSummary; readonly t: Translate }): ReactNode {
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
    </li>
  )
}

/** Render the read-only MCP server status list of the Plugins settings section. */
export function McpSettingsTab({ list, t }: McpSettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

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
  const servers = state.status === 'ready' ? state.snapshot.servers : []

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
      {state.status === 'ready' && servers.length === 0 ? (
        <div className={css.empty} data-mcp-empty>
          <p className={css.emptyTitle}>{t('emptyTitle')}</p>
          <p className={css.status}>{t('emptyBody')}</p>
          <pre className={css.code}>{EXAMPLE_ENTRY}</pre>
        </div>
      ) : null}
      {state.status === 'ready' && servers.length > 0 ? (
        <>
          <div className={css.toolbar}>
            <span className={css.status} data-mcp-count={servers.length}>{t(servers.length === 1 ? 'summaryOne' : 'summary', { count: String(servers.length) })}</span>
            <button type="button" className={css.refresh} aria-label={t('refreshLabel')} onClick={refresh}>
              <IconRefreshOutlineRegular size={14} aria-hidden="true" />{t('refresh')}
            </button>
          </div>
          <ul className={css.list}>
            {servers.map(server => <ServerRow key={server.key} server={server} t={t} />)}
          </ul>
        </>
      ) : null}
    </div>
  )
}
