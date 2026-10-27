import { describe, expect, it } from 'vitest'
import { maskArgs, maskUrl, scrubSecrets } from '../src/mask.ts'
import {
  addMcpRow, McpPatchError, readMcpRows, removeMcpRow, setMcpRowEnabled, updateMcpRow,
} from '../src/patch-file.ts'

const FILE = `# Servers I use every day.
- id: persona
  config:
    name: keep me
- insert:
    # Power BI model access.
    - id: mcp-powerbi
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: powerbi
        transport: stdio
        command: npx
        args: ['-y', '@microsoft/powerbi-modeling-mcp@latest', '--start']
        env:
          PBI_TOKEN: super-secret-token
        cwd: C:/work
        reconnect:
          maxAttempts: 3
    - id: mcp-computed
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: computed
        transport: stdio
        command: !!js process.execPath
        args: []
- insert:
    - id: mcp-remote
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: remote
        transport: streamable-http
        url: https://mcp.example.com/api?key=abcd1234
        headers:
          Authorization: Bearer abcdef123456
`

function row(text: string, id: string) {
  const found = readMcpRows(text).find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`missing row ${id}`)
  return found
}

describe('readMcpRows', () => {
  it('lists only mcp-client rows of insert items, with env and header names but no values', () => {
    const rows = readMcpRows(FILE)
    expect(rows.map(candidate => candidate.id)).toEqual(['mcp-powerbi', 'mcp-computed', 'mcp-remote'])
    expect(row(FILE, 'mcp-powerbi')).toMatchObject({
      serverName: 'powerbi', transport: 'stdio', command: 'npx', envKeys: ['PBI_TOKEN'], disabled: false, editable: true,
    })
    expect(JSON.stringify(rows)).not.toContain('super-secret-token')
    expect(row(FILE, 'mcp-remote')).toMatchObject({ transport: 'streamable-http', headerKeys: ['Authorization'], editable: true })
  })

  it('marks a row with an expression in a form field as not editable', () => {
    expect(row(FILE, 'mcp-computed').editable).toBe(false)
  })

  it('treats an empty file as no rows and rejects a non-list file', () => {
    expect(readMcpRows('')).toEqual([])
    expect(readMcpRows('[]\n')).toEqual([])
    expect(() => readMcpRows('a: 1\n')).toThrow(McpPatchError)
    expect(() => readMcpRows('- [unclosed')).toThrow(McpPatchError)
  })
})

describe('addMcpRow', () => {
  it('appends a new insert item and leaves everything else byte-identical', () => {
    const next = addMcpRow(FILE, {
      name: 'docs', transport: 'stdio', command: 'npx', args: [{ value: '-y' }, { value: '@scope/docs' }], env: { API_KEY: 'k-123456' },
    }, 'mcp-docs')
    expect(next.startsWith(FILE)).toBe(true)
    expect(row(next, 'mcp-docs')).toMatchObject({ serverName: 'docs', command: 'npx', envKeys: ['API_KEY'] })
    expect(next).toContain('- id: mcp-docs')
    expect(next).toContain("name: '@deepseek-ai/dsh-mcp-client'")
  })

  it('creates the list when the file does not exist yet', () => {
    const next = addMcpRow('', { name: 'solo', transport: 'streamable-http', url: 'https://mcp.example.com/mcp' }, 'mcp-solo')
    expect(readMcpRows(next)).toMatchObject([{ id: 'mcp-solo', transport: 'streamable-http', url: 'https://mcp.example.com/mcp' }])
  })

  it('rejects bad names, missing fields, non-http urls, and a reused id', () => {
    const base = { transport: 'stdio' as const, command: 'x' }
    expect(() => addMcpRow(FILE, { ...base, name: 'bad name' }, 'mcp-a')).toThrow(/name/)
    expect(() => addMcpRow(FILE, { name: 'a', transport: 'stdio' }, 'mcp-a')).toThrow(/command is required/)
    expect(() => addMcpRow(FILE, { name: 'a', transport: 'streamable-http', url: 'ftp://x' }, 'mcp-a')).toThrow(/http/)
    expect(() => addMcpRow(FILE, { name: 'a', transport: 'streamable-http' }, 'mcp-a')).toThrow(/url is required/)
    expect(() => addMcpRow(FILE, { name: 'a', transport: 'streamable-http', url: 'https://x/••••' }, 'mcp-a')).toThrow(/placeholder/)
    expect(() => addMcpRow(FILE, { ...base, name: 'a' }, 'mcp-powerbi')).toThrow(/already exists/)
    expect(() => addMcpRow(FILE, { ...base, name: 'a', env: { 'BAD-KEY': 'v' } }, 'mcp-a')).toThrow(/env name/)
    expect(() => addMcpRow(FILE, { ...base, name: 'a', env: { KEPT: null } }, 'mcp-a')).toThrow(/no stored value/)
  })
})

describe('updateMcpRow', () => {
  it('changes form fields, keeps unrelated fields and comments, and keeps unchanged secrets', () => {
    const next = updateMcpRow(FILE, 'mcp-powerbi', {
      name: 'powerbi2',
      transport: 'stdio',
      command: 'node',
      args: [{ value: 'server.js' }, { keep: 2 }],
      env: { PBI_TOKEN: null, EXTRA: 'x-value' },
    })
    expect(next).toContain('# Servers I use every day.')
    expect(next).toContain('# Power BI model access.')
    expect(next).toContain('cwd: C:/work')
    expect(next).toContain('maxAttempts: 3')
    expect(next).toContain('PBI_TOKEN: super-secret-token')
    expect(next).toContain('EXTRA: x-value')
    expect(row(next, 'mcp-powerbi')).toMatchObject({ serverName: 'powerbi2', command: 'node' })
    expect(row(next, 'mcp-powerbi').args.map(arg => arg.text)).toEqual(['server.js', '--start'])
    // Rows the edit did not touch are unchanged.
    expect(next).toContain('url: https://mcp.example.com/api?key=abcd1234')
  })

  it('drops the env variables the draft omits and the fields of the other transport on a switch', () => {
    const next = updateMcpRow(FILE, 'mcp-powerbi', { name: 'powerbi', transport: 'streamable-http', url: 'https://x.example.com/mcp' })
    expect(next).not.toContain('PBI_TOKEN')
    expect(next).not.toContain('@microsoft/powerbi-modeling-mcp')
    expect(row(next, 'mcp-powerbi')).toMatchObject({ transport: 'streamable-http', url: 'https://x.example.com/mcp' })
  })

  it('keeps the stored url and header values when the draft sends none', () => {
    const next = updateMcpRow(FILE, 'mcp-remote', { name: 'remote', transport: 'streamable-http', headers: { Authorization: null } })
    expect(next).toContain('url: https://mcp.example.com/api?key=abcd1234')
    expect(next).toContain('Authorization: Bearer abcdef123456')
  })

  it('refuses an unknown row, a row with expressions, and a stale kept argument', () => {
    const draft = { name: 'x', transport: 'stdio' as const, command: 'x' }
    expect(() => updateMcpRow(FILE, 'mcp-missing', draft)).toThrow(expect.objectContaining({ kind: 'not-found' }))
    expect(() => updateMcpRow(FILE, 'mcp-computed', draft)).toThrow(/expressions/)
    expect(() => updateMcpRow(FILE, 'mcp-powerbi', { ...draft, args: [{ keep: 9 }] })).toThrow(/no longer exists/)
  })
})

describe('setMcpRowEnabled and removeMcpRow', () => {
  it('disables with a disabled flag and enables by removing it', () => {
    const off = setMcpRowEnabled(FILE, 'mcp-powerbi', false)
    expect(row(off, 'mcp-powerbi').disabled).toBe(true)
    expect(off).toContain('# Power BI model access.')
    expect(setMcpRowEnabled(off, 'mcp-powerbi', true)).toBe(FILE)
  })

  it('removes one row and drops the insert item that held only it', () => {
    const one = removeMcpRow(FILE, 'mcp-remote')
    expect(readMcpRows(one).map(candidate => candidate.id)).toEqual(['mcp-powerbi', 'mcp-computed'])
    expect(one).not.toContain('abcd1234')
    expect(one).toContain('- id: persona')
    const two = removeMcpRow(removeMcpRow(one, 'mcp-powerbi'), 'mcp-computed')
    expect(readMcpRows(two)).toEqual([])
    expect(two).toContain('- id: persona')
  })

  it('reports a missing row', () => {
    expect(() => removeMcpRow(FILE, 'nope')).toThrow(expect.objectContaining({ kind: 'not-found' }))
    expect(() => setMcpRowEnabled(FILE, 'nope', true)).toThrow(McpPatchError)
  })
})

describe('masking', () => {
  it('hides the value after a credential option, KEY=value assignments, and credential shapes', () => {
    expect(maskArgs(['-y', 'pkg', '--api-key', 'abc123', '--token=xyz', 'API_KEY=zzz', 'gsk_live_value', '--port', '3000'])).toEqual([
      { text: '-y', masked: false },
      { text: 'pkg', masked: false },
      { text: '--api-key', masked: false },
      { text: '••••', masked: true },
      { text: '--token=••••', masked: true },
      { text: 'API_KEY=••••', masked: true },
      { text: '••••', masked: true },
      { text: '--port', masked: false },
      { text: '3000', masked: false },
    ])
  })

  it('hides url credentials, query values, and opaque path segments but not an ordinary url', () => {
    expect(maskUrl('https://user:pw@mcp.example.com/a/b?key=1&x=2')).toEqual({ text: 'https://••••@mcp.example.com/a/b?key=••••&x=••••', masked: true })
    expect(maskUrl('https://mcp.example.com/s/abcdefghijklmnopqrstuvwxyz')).toEqual({ text: 'https://mcp.example.com/s/••••', masked: true })
    expect(maskUrl('http://localhost:3000/mcp')).toEqual({ text: 'http://localhost:3000/mcp', masked: false })
    expect(maskUrl('not a url')).toEqual({ text: '••••', masked: true })
  })

  it('scrubs secrets from a message, longest first, and ignores very short values', () => {
    expect(scrubSecrets('bad token abc12345 and abc12 ok', ['abc12', 'abc12345', 'ok'])).toBe('bad token *** and *** ok')
  })
})
