/**
 * Host owner of the `remoteAccess` Remote namespace: a switch that publishes
 * this server on the user's tailnet through Tailscale Serve, so a phone signed
 * into the same Tailscale account can open it. Serve is the only path in — the
 * server stays bound to loopback — and the tailnet host name is admitted to the
 * Host/Origin fence at runtime for exactly as long as the switch is on.
 *
 * Everything here talks to the `tailscale` CLI, which may be absent, stopped,
 * or not signed in; each of those is an ordinary answer, never an exception.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/remote-access.ts
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteAccessStatus } from './types.ts'

/** How long one `tailscale` invocation may take before it counts as failed. */
const TAILSCALE_TIMEOUT_MS = 20_000

/** Page that enables Serve for a tailnet when Tailscale reports it is off. */
const ENABLE_SERVE_URL = 'https://login.tailscale.com/f/serve'

/**
 * Where the `tailscale` CLI usually lives, tried in order. A bare name relies on
 * PATH; the others cover installs that do not add themselves to it.
 */
export function tailscaleCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = env['FORGE_TAILSCALE']
  return [
    ...fromEnv === undefined || fromEnv.length === 0 ? [] : [fromEnv],
    'tailscale',
    ...['ProgramFiles', 'ProgramFiles(x86)']
      .map(name => env[name])
      .filter((root): root is string => root !== undefined && root.length > 0)
      .map(root => `${root}\\Tailscale\\tailscale.exe`),
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ]
}

/** One finished `tailscale` call: its exit code and merged output. */
export interface TailscaleResult {
  code: number
  output: string
}

/** Runs the CLI with arguments; `undefined` means no `tailscale` binary exists. */
export type TailscaleRunner = (args: readonly string[]) => Promise<TailscaleResult | undefined>

/** Default runner: the first candidate that exists runs the command and is remembered. */
export function createTailscaleRunner(candidates: readonly string[] = tailscaleCandidates()): TailscaleRunner {
  let found: string | undefined
  const attempt = (binary: string, args: readonly string[]): Promise<TailscaleResult | 'missing'> =>
    new Promise((resolve) => {
      execFile(binary, [...args], { timeout: TAILSCALE_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        if (error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve('missing')
          return
        }
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, output: `${stdout}${stderr}` })
      })
    })
  return async (args) => {
    // The binary that answered last time goes first, so later calls skip the misses.
    const order = found === undefined ? candidates : [found, ...candidates.filter(binary => binary !== found)]
    for (const binary of order) {
      const result = await attempt(binary, args)
      if (result !== 'missing') {
        found = binary
        return result
      }
    }
    return undefined
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `remoteAccess` Remote namespace. */
    remoteAccessController: RemoteAccessController
  }
}

/** Parse JSON output, or `undefined` when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Read a string member of an object-shaped value. */
function memberString(value: unknown, ...path: string[]): string | undefined {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : undefined
}

/** Preference file: `on` when the user left the switch on, so the next boot restores it. */
export function remoteAccessPreferencePath(): string {
  return dshHomePath('remote-access')
}

/**
 * Host service backing the generated `ctx.remote.remoteAccess` namespace. The
 * link it returns carries the process login token, so it is as sensitive as the
 * address bar of the Forge tab it is opened from: it only ever answers the
 * authenticated operator, who already holds that token.
 */
export class RemoteAccessController extends TypertRemoteService {
  private readonly run: TailscaleRunner
  private withdraw: (() => void) | undefined
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host context where `connection` and `webServer` are mounted.
   * @param options - `run` replaces the Tailscale runner (tests).
   */
  constructor(ctx: Context, options: { run?: TailscaleRunner } = {}) {
    super(ctx, 'remoteAccessController', { namespace: 'remoteAccess' })
    this.run = options.run ?? createTailscaleRunner()
    ctx.inject(['connection', 'webServer'], (webCtx) => {
      // Restore the switch left on at the last shutdown, once the server is up.
      void this.exclusive(async () => {
        if (await this.readPreference()) await this.turnOn()
      })
      webCtx.effect(() => () => {
        this.withdraw?.()
        this.withdraw = undefined
      }, 'remote-access: trusted host')
    })
  }

  /**
   * Read the current state of the switch without changing it.
   * @returns `on` with the phone link, `off`, or why Tailscale cannot be used.
   */
  @Remote
  async status(): Promise<RemoteAccessStatus> {
    return await this.exclusive(() => this.describe())
  }

  /**
   * Publish this server on the tailnet and admit its host name.
   * @returns `on` with the phone link, or why it could not be switched on.
   */
  @Remote
  async enable(): Promise<RemoteAccessStatus> {
    return await this.exclusive(async () => {
      const result = await this.turnOn()
      if (result.state === 'on') await this.writePreference(true)
      return result
    })
  }

  /**
   * Stop publishing and withdraw the host name from the fence.
   * @returns the state after switching off.
   */
  @Remote
  async disable(): Promise<RemoteAccessStatus> {
    return await this.exclusive(async () => {
      this.withdraw?.()
      this.withdraw = undefined
      await this.run(['serve', 'reset'])
      await this.writePreference(false)
      return await this.describe()
    })
  }

  /** Serialize calls: each one sees the state the previous one left. */
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Tailnet host name when Tailscale is connected, else the status that explains why not. */
  private async connectedHost(): Promise<{ host: string } | RemoteAccessStatus> {
    const result = await this.run(['status', '--json'])
    if (result === undefined) return { state: 'unavailable' }
    const parsed = parseJson(result.output)
    if (memberString(parsed, 'BackendState') !== 'Running') return { state: 'needs-login' }
    const dns = memberString(parsed, 'Self', 'DNSName')?.replace(/\.$/, '')
    if (dns === undefined || dns.length === 0) {
      return { state: 'failed', detail: 'Tailscale reported no host name for this computer' }
    }
    return { host: dns }
  }

  private async describe(): Promise<RemoteAccessStatus> {
    const connected = await this.connectedHost()
    if (!('host' in connected)) return connected
    const link = this.withdraw === undefined ? undefined : this.phoneUrl(connected.host)
    return link === undefined ? { state: 'off', host: connected.host } : { state: 'on', host: connected.host, url: link }
  }

  private phoneUrl(host: string): string | undefined {
    return this.ctx.get('connection')?.authenticatedUrl(`https://${host}`)
  }

  /** Publish and admit; the preference is written by the caller that was asked to. */
  private async turnOn(): Promise<RemoteAccessStatus> {
    const connection = this.ctx.get('connection')
    const port = this.ctx.get('webServer')?.port
    if (connection === undefined || port === undefined) {
      return { state: 'failed', detail: 'the web server is not running in this process' }
    }
    const connected = await this.connectedHost()
    if (!('host' in connected)) return connected
    const served = await this.run(['serve', '--bg', String(port)])
    if (served === undefined) return { state: 'unavailable' }
    if (served.code !== 0) {
      if (/not enabled|enable/i.test(served.output)) {
        const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(served.output)?.[0] ?? ENABLE_SERVE_URL
        return { state: 'needs-serve', host: connected.host, link }
      }
      return { state: 'failed', host: connected.host, detail: served.output.trim().split('\n')[0] || 'tailscale serve failed' }
    }
    this.withdraw?.()
    this.withdraw = connection.trustHost(connected.host)
    return { state: 'on', host: connected.host, url: connection.authenticatedUrl(`https://${connected.host}`) }
  }

  private async readPreference(): Promise<boolean> {
    try {
      return (await readFile(remoteAccessPreferencePath(), 'utf8')).trim() === 'on'
    } catch {
      return false
    }
  }

  private async writePreference(on: boolean): Promise<void> {
    const path = remoteAccessPreferencePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, on ? 'on\n' : 'off\n', 'utf8')
  }
}

export default RemoteAccessController
