/** `dsh mcp` lists and toggles MCP rows in a profile patch or the shared home patch. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { runMcp } from '../src/mcp.ts'

const PROFILE_PATCH = `# MCP servers for the test profile
- insert:
    - id: mcp-stdio
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: stdio
        transport: stdio
        command: npx
        args: ['stdio-server']
    - id: mcp-http
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: http
        transport: streamable-http
        url: https://example.invalid/mcp
      disabled: true
`

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'cli-mcp-'))
  vi.stubEnv('DSH_HOME', home)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const profileDir = join(home, 'profiles', 'test')
  mkdirSync(profileDir, { recursive: true })
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  })
  return { home, profileDir, stdout, stderr }
}

function patch(dir: string): string {
  return join(dir, 'cordis.patch.yml')
}

it('lists MCP rows of a profile patch with their on/off state', async () => {
  const { profileDir, stdout } = fixture()
  writeFileSync(patch(profileDir), PROFILE_PATCH)
  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'list' })).toBe(0)
  const output = stdout.mock.calls.map(call => call[0]).join('')
  expect(output).toContain('profile "test"')
  expect(output).toContain('on\tmcp-stdio\tstdio\tstdio')
  expect(output).toContain('off\tmcp-http\tstreamable-http\thttp')
})

it('turns a server off by setting the disabled flag and back on by removing it', async () => {
  const { profileDir, stdout } = fixture()
  const file = patch(profileDir)
  writeFileSync(file, PROFILE_PATCH)

  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'off', id: 'mcp-stdio' })).toBe(0)
  expect(stdout).toHaveBeenCalledWith('dsh: off mcp-stdio in profile "test"\n')
  // baseline: only mcp-http is disabled
  const countDisabled = (text: string) => (text.match(/disabled: true/g) ?? []).length
  expect(countDisabled(readFileSync(file, 'utf8'))).toBe(2)

  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'on', id: 'mcp-stdio' })).toBe(0)
  expect(stdout).toHaveBeenCalledWith('dsh: on mcp-stdio in profile "test"\n')
  // mcp-http stays disabled, mcp-stdio reverts to enabled -> back to 1
  expect(countDisabled(readFileSync(file, 'utf8'))).toBe(1)
})

it('reports when a server is already in the wanted state', async () => {
  const { profileDir, stdout } = fixture()
  const file = patch(profileDir)
  writeFileSync(file, PROFILE_PATCH)

  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'off', id: 'mcp-http' })).toBe(0)
  expect(stdout).toHaveBeenCalledWith('dsh: mcp-http is already off\n')
})

it('fails cleanly when the targeted id is absent', async () => {
  const { profileDir, stderr } = fixture()
  writeFileSync(patch(profileDir), PROFILE_PATCH)
  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'off', id: 'mcp-missing' })).toBe(1)
  expect(stderr.mock.calls.map(call => call[0]).join('')).toContain('no MCP server with id "mcp-missing"')
})

it('lists as empty when the patch file does not exist yet', async () => {
  const { stdout } = fixture()
  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'list' })).toBe(0)
  expect(stdout.mock.calls.map(call => call[0]).join('')).toContain('no MCP servers configured')
})

it('refuses to toggle a server in a profile without a patch file', async () => {
  const { stderr } = fixture()
  expect(await runMcp({ scope: 'profile', profile: 'test', operation: 'on', id: 'mcp-stdio' })).toBe(1)
  expect(stderr.mock.calls.map(call => call[0]).join('')).toContain('no patch file at')
})

it('toggles a server in the shared home patch', async () => {
  const { home, stdout, stderr } = fixture()
  const file = patch(home)
  writeFileSync(file, PROFILE_PATCH)
  expect(await runMcp({ scope: 'home', operation: 'off', id: 'mcp-stdio' })).toBe(0)
  expect(stdout).toHaveBeenCalledWith('dsh: off mcp-stdio in home\n')
  expect(readFileSync(file, 'utf8')).toContain('disabled: true')
  expect(stderr).not.toHaveBeenCalled()
})
