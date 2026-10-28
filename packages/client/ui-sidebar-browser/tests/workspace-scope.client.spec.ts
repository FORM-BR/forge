import { describe, expect, it } from 'vitest'
import { isInsideWorkspace } from '../src/client/browser/workspace-scope.ts'

describe('isInsideWorkspace', () => {
  it('keeps relative paths inside unless a .. climbs above the root', () => {
    expect(isInsideWorkspace('/work', './notes.md')).toBe(true)
    expect(isInsideWorkspace('/work', 'a/../b.md')).toBe(true)
    expect(isInsideWorkspace('/work', '../notes.md')).toBe(false)
    expect(isInsideWorkspace('/work', 'a/../../notes.md')).toBe(false)
    expect(isInsideWorkspace('C:\\work', '..\\other\\notes.md')).toBe(false)
    expect(isInsideWorkspace(undefined, './deep/notes.md')).toBe(true)
    expect(isInsideWorkspace(undefined, '../notes.md')).toBe(false)
  })

  it('compares absolute POSIX paths segment by segment and resolves ..', () => {
    expect(isInsideWorkspace('/work', '/work')).toBe(true)
    expect(isInsideWorkspace('/work/', '/work/a/b.html')).toBe(true)
    expect(isInsideWorkspace('/work', '/work/a/../b.html')).toBe(true)
    expect(isInsideWorkspace('/work', '/work/../etc/passwd')).toBe(false)
    expect(isInsideWorkspace('/work', '/work2/a.md')).toBe(false)
    expect(isInsideWorkspace('/work/sub', '/work/a.md')).toBe(false)
    expect(isInsideWorkspace('/work/./x/..', '/work/a.md')).toBe(true)
    expect(isInsideWorkspace('/', '/etc/hosts')).toBe(true)
    expect(isInsideWorkspace('/work', '/Work/a.md')).toBe(false)
    expect(isInsideWorkspace('/work', '/../work/a.md')).toBe(true)
  })

  it('ignores case and separator spelling for Windows drive and UNC paths', () => {
    expect(isInsideWorkspace('C:\\Users\\Felipe\\Proj', 'c:/users/felipe/proj/docs/Index.html')).toBe(true)
    expect(isInsideWorkspace('c:/users/felipe/proj', 'C:\\Users\\Felipe\\Proj\\..\\Other\\x.md')).toBe(false)
    expect(isInsideWorkspace('C:\\Users\\Felipe\\Proj', 'C:\\Users\\Felipe\\Projeto\\x.md')).toBe(false)
    expect(isInsideWorkspace('\\\\server\\share\\proj', '\\\\SERVER\\share\\proj\\a.md')).toBe(true)
    expect(isInsideWorkspace('\\\\server\\share\\proj', '\\\\server\\share\\other\\a.md')).toBe(false)
    expect(isInsideWorkspace('C:\\work', 'D:\\work\\a.md')).toBe(false)
  })

  it('treats an absolute path as outside when the root is unknown, relative, or of another kind', () => {
    expect(isInsideWorkspace(undefined, '/work/a.md')).toBe(false)
    expect(isInsideWorkspace('', 'C:\\work\\a.md')).toBe(false)
    expect(isInsideWorkspace('work', '/work/a.md')).toBe(false)
    expect(isInsideWorkspace('/work', 'C:\\work\\a.md')).toBe(false)
  })
})
