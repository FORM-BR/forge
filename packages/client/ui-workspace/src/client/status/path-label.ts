/** Display abbreviation of a Host directory path for the workspace status line. */

/** Longest path, in characters, shown whole. */
export const PATH_LABEL_MAX = 44

/**
 * Shorten a long directory path to its trailing segments behind an ellipsis.
 * The separator style of the input is kept, so a Windows path stays
 * backslash-separated. A path that already fits, and a path whose last segment
 * alone exceeds the limit, are returned whole (the status line's CSS ellipsis
 * clips the latter).
 * @param path - fully qualified Host directory.
 * @param max - character budget for the result, including the ellipsis.
 * @returns the path, or an ellipsis plus the longest trailing segments that fit.
 */
export function abbreviatePath(path: string, max: number = PATH_LABEL_MAX): string {
  if (path.length <= max) return path
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const segments = path.split(/[\\/]/).filter(segment => segment !== '')
  let tail = ''
  for (const segment of segments.reverse()) {
    const next = tail === '' ? segment : `${segment}${separator}${tail}`
    if (tail !== '' && next.length + 2 > max) break
    tail = next
  }
  return `…${separator}${tail}`
}
