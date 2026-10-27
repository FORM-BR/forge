import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteAccessController,
  createTailscaleRunner,
  remoteAccessPreferencePath,
  tailscaleCandidates,
} from '../src/remote-access.ts'
import type { TailscaleResult, TailscaleRunner } from '../src/remote-access.ts'

const RUNNING = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc-teste.tail123.ts.net.' } })

/** Scripted CLI: answers by the first words of the command line; unknown commands succeed silently. */
function scripted(answers: Record<string, TailscaleResult | undefined>): TailscaleRunner & { calls: string[] } {
  const calls: string[] = []
  const run = ((args: readonly string[]) => {
    const key = args.slice(0, 2).join(' ')
    calls.push(args.join(' '))
    const first = args[0] ?? ''
    const answer = key in answers ? answers[key] : first in answers ? answers[first] : { code: 0, output: '' }
    return Promise.resolve(answer)
  }) as TailscaleRunner & { calls: string[] }
  run.calls = calls
  return run
}

let home: string
let previousHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'forge-remote-access-'))
  previousHome = process.env['DSH_HOME']
  process.env['DSH_HOME'] = home
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = previousHome
  await rm(home, { recursive: true, force: true })
})

/** A context with the web server and connection services the controller waits for. */
async function boot(run: TailscaleRunner, options: { services?: boolean } = {}) {
  const ctx = new Context()
  const trusted: string[] = []
  const withdrawn: string[] = []
  const connection = {
    trustHost: vi.fn((authority: string) => {
      trusted.push(authority)
      return () => { withdrawn.push(authority) }
    }),
    authenticatedUrl: vi.fn((base: string) => `${base}/?token=tok`),
  }
  if (options.services !== false) {
    ctx.provide('connection', connection as never)
    ctx.provide('webServer', { port: 3080 } as never)
  }
  const fiber = ctx.plugin(RemoteAccessController, { run })
  await fiber.await()
  return { ctx, fiber, controller: ctx.remoteAccessController, connection, trusted, withdrawn }
}

describe('the remoteAccess Remote namespace', () => {
  it('publishes its own namespace with status, enable and disable', async () => {
    const { controller } = await boot(scripted({}))
    expect(controller.typertRemote.namespace).toBe('remoteAccess')
    expect(remoteMethods(controller)).toEqual([
      { method: 'status', invocation: { kind: 'direct' } },
      { method: 'enable', invocation: { kind: 'direct' } },
      { method: 'disable', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the reasons Tailscale cannot be used', async () => {
    expect((await (await boot(scripted({ status: undefined }))).controller.status()).state).toBe('unavailable')
    expect((await (await boot(scripted({ status: { code: 1, output: '{"BackendState":"Stopped"}' } }))).controller.status()).state)
      .toBe('needs-login')
    expect((await (await boot(scripted({ status: { code: 1, output: 'not json' } }))).controller.status()).state)
      .toBe('needs-login')
    expect((await (await boot(scripted({ status: { code: 0, output: '{"BackendState":5}' } }))).controller.status()).state)
      .toBe('needs-login')
    expect((await (await boot(scripted({ status: { code: 0, output: '{"BackendState":"Running","Self":null}' } }))).controller.status()).state)
      .toBe('failed')
    expect(await (await boot(scripted({ status: { code: 0, output: '{"BackendState":"Running"}' } }))).controller.status())
      .toEqual({ state: 'failed', detail: 'Tailscale reported no host name for this computer' })
    expect(await (await boot(scripted({ status: { code: 0, output: '{"BackendState":"Running","Self":{"DNSName":""}}' } }))).controller.status())
      .toEqual({ state: 'failed', detail: 'Tailscale reported no host name for this computer' })
  })

  it('is off until switched on, and shows the host name', async () => {
    const { controller } = await boot(scripted({ status: { code: 0, output: RUNNING } }))
    expect(await controller.status()).toEqual({ state: 'off', host: 'pc-teste.tail123.ts.net' })
  })

  it('switches on: publishes the port, admits the host name, remembers it, and returns the phone link', async () => {
    const run = scripted({ status: { code: 0, output: RUNNING } })
    const { controller, trusted } = await boot(run)
    const on = await controller.enable()
    expect(on).toEqual({ state: 'on', host: 'pc-teste.tail123.ts.net', url: 'https://pc-teste.tail123.ts.net/?token=tok' })
    expect(run.calls).toContain('serve --bg 3080')
    expect(trusted).toEqual(['pc-teste.tail123.ts.net'])
    expect(await readFile(remoteAccessPreferencePath(), 'utf8')).toBe('on\n')
    expect(await controller.status()).toEqual(on)
  })

  it('replaces its previous admission when switched on again', async () => {
    const { controller, trusted, withdrawn } = await boot(scripted({ status: { code: 0, output: RUNNING } }))
    await controller.enable()
    await controller.enable()
    expect(trusted).toHaveLength(2)
    expect(withdrawn).toEqual(['pc-teste.tail123.ts.net'])
  })

  it('asks to enable Serve, with the page Tailscale names or the default one', async () => {
    const needs = (output: string) => scripted({ status: { code: 0, output: RUNNING }, 'serve --bg': { code: 1, output } })
    const named = await (await boot(needs('Serve is not enabled on your tailnet.\nTo enable, visit: https://login.tailscale.com/f/serve?node=abc'))).controller.enable()
    expect(named).toEqual({ state: 'needs-serve', host: 'pc-teste.tail123.ts.net', link: 'https://login.tailscale.com/f/serve?node=abc' })
    const generic = await (await boot(needs('Serve is not enabled'))).controller.enable()
    expect(generic.link).toBe('https://login.tailscale.com/f/serve')
    await expect(readFile(remoteAccessPreferencePath(), 'utf8')).rejects.toThrow()
  })

  it('reports other serve failures by their first line', async () => {
    const failing = (output: string) => scripted({ status: { code: 0, output: RUNNING }, 'serve --bg': { code: 1, output } })
    expect(await (await boot(failing('boom\nmore'))).controller.enable())
      .toEqual({ state: 'failed', host: 'pc-teste.tail123.ts.net', detail: 'boom' })
    expect((await (await boot(failing(''))).controller.enable()).detail).toBe('tailscale serve failed')
  })

  it('reports Tailscale as unavailable when it disappears between status and serve', async () => {
    const { controller } = await boot(scripted({ status: { code: 0, output: RUNNING }, 'serve --bg': undefined }))
    expect((await controller.enable()).state).toBe('unavailable')
  })

  it('refuses to switch on without a running web server', async () => {
    const { controller } = await boot(scripted({ status: { code: 0, output: RUNNING } }), { services: false })
    expect(await controller.enable()).toEqual({ state: 'failed', detail: 'the web server is not running in this process' })
  })

  it('does not switch on when Tailscale is not connected', async () => {
    const { controller, trusted } = await boot(scripted({ status: { code: 0, output: '{"BackendState":"NeedsLogin"}' } }))
    expect((await controller.enable()).state).toBe('needs-login')
    expect(trusted).toEqual([])
  })

  it('switches off: resets Serve, withdraws the host name and remembers it', async () => {
    const run = scripted({ status: { code: 0, output: RUNNING } })
    const { controller, withdrawn } = await boot(run)
    await controller.enable()
    expect(await controller.disable()).toEqual({ state: 'off', host: 'pc-teste.tail123.ts.net' })
    expect(run.calls).toContain('serve reset')
    expect(withdrawn).toEqual(['pc-teste.tail123.ts.net'])
    expect(await readFile(remoteAccessPreferencePath(), 'utf8')).toBe('off\n')
  })

  it('switches off even when nothing was on', async () => {
    const { controller } = await boot(scripted({ status: { code: 0, output: RUNNING } }))
    expect((await controller.disable()).state).toBe('off')
  })

  it('restores a switch left on at the last shutdown, and withdraws on dispose', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(remoteAccessPreferencePath(), 'on\n')
    const run = scripted({ status: { code: 0, output: RUNNING } })
    const { fiber, trusted, withdrawn } = await boot(run)
    await vi.waitFor(() => { expect(trusted).toEqual(['pc-teste.tail123.ts.net']) })
    expect(run.calls).toContain('serve --bg 3080')
    await fiber.dispose()
    expect(withdrawn).toEqual(['pc-teste.tail123.ts.net'])
  })

  it('stays off at boot when the switch was left off or never set', async () => {
    const run = scripted({ status: { code: 0, output: RUNNING } })
    const { controller, trusted } = await boot(run)
    await controller.status()
    expect(trusted).toEqual([])
    expect(run.calls).not.toContain('serve --bg 3080')
  })

  it('keeps answering after a call fails', async () => {
    let explode = true
    const run: TailscaleRunner = () => {
      if (explode) { explode = false; return Promise.reject(new Error('spawn failed')) }
      return Promise.resolve({ code: 0, output: RUNNING })
    }
    const { controller } = await boot(run)
    await expect(controller.status()).rejects.toThrow('spawn failed')
    expect((await controller.status()).state).toBe('off')
  })
})

describe('locating and running the tailscale CLI', () => {
  it('lists the environment override first, then PATH, then the usual install folders', () => {
    expect(tailscaleCandidates({ FORGE_TAILSCALE: 'C:\\custom\\ts.exe', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }))
      .toEqual([
        'C:\\custom\\ts.exe',
        'tailscale',
        'C:\\Program Files\\Tailscale\\tailscale.exe',
        'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      ])
    expect(tailscaleCandidates({ FORGE_TAILSCALE: '' })).toEqual(['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'])
  })

  it('uses the first candidate that exists, remembers it, and merges exit code and output', async () => {
    const run = createTailscaleRunner(['definitely-not-a-real-binary-xyz', process.execPath])
    expect(await run(['-e', 'console.log("hi"); console.error("err")'])).toEqual({ code: 0, output: expect.stringContaining('hi') })
    expect(await run(['-e', 'process.exit(3)'])).toMatchObject({ code: 3 })
  })

  it('reports a failure that carries no numeric exit code as exit code 1', async () => {
    const run = createTailscaleRunner([process.execPath])
    // More output than execFile buffers: the error code is a string, not an exit status.
    expect((await run(['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))']))?.code).toBe(1)
  })

  it('answers undefined when no candidate exists', async () => {
    expect(await createTailscaleRunner(['definitely-not-a-real-binary-xyz'])(['status'])).toBeUndefined()
  })

  it('defaults to the standard candidates', () => {
    expect(typeof createTailscaleRunner()).toBe('function')
  })
})
