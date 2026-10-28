/** Whether an address-bar file path stays inside the Session's workspace root. */

/** Leading root of an absolute path after separators were normalized to `/`: drive, UNC, or POSIX. */
const ROOT = /^(?:[A-Za-z]:\/|\/\/|\/)/u

/**
 * Fold `.` and `..` segments into `parts`.
 * @param rest - normalized path below its root.
 * @param parts - accumulated segments, mutated in place.
 * @returns `true` when no `..` climbed above the starting directory.
 */
function fold(rest: string, parts: string[]): boolean {
  let climbed = false
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length === 0) climbed = true
    else parts.pop()
  }
  return !climbed
}

/**
 * Decide whether a file path typed in the address bar resolves inside the
 * workspace. Separators are normalized, `.` and `..` are resolved, and the
 * comparison ignores case for Windows spellings (drive letter or UNC).
 * A relative path is inside unless a `..` climbs above the workspace root; an
 * absolute path is inside only when the workspace root is known and is a
 * segment-wise prefix of it, so `/work2` is not inside `/work`.
 * @param cwd - the Session's workspace root, when known.
 * @param path - trimmed address-bar value, absolute or relative, either separator.
 * @returns `true` when opening it needs no confirmation.
 */
export function isInsideWorkspace(cwd: string | undefined, path: string): boolean {
  const target = path.replace(/\\/gu, '/')
  const targetRoot = ROOT.exec(target)?.[0]
  if (targetRoot === undefined) return fold(target, [])
  const base = (cwd ?? '').replace(/\\/gu, '/')
  const baseRoot = ROOT.exec(base)?.[0]
  if (baseRoot === undefined) return false
  const windows = targetRoot !== '/' || baseRoot !== '/'
  const same = (left: string, right: string): boolean => windows ? left.toLowerCase() === right.toLowerCase() : left === right
  if (!same(targetRoot, baseRoot)) return false
  const targetParts: string[] = []
  const baseParts: string[] = []
  fold(target.slice(targetRoot.length), targetParts)
  fold(base.slice(baseRoot.length), baseParts)
  const head = targetParts.slice(0, baseParts.length)
  return head.length === baseParts.length && same(head.join('/'), baseParts.join('/'))
}
