/** Leading icon for a shell row whose command is a Git or GitHub subcommand. */
import type { ReactNode } from 'react'
import type { GitAction } from '../models/git-command.ts'

/** Stroke-shaped glyphs on a 16-unit grid; every action shares the row's current color. */
const GLYPHS: Readonly<Record<GitAction, ReactNode>> = {
  commit: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v3.8M8 10.6v3.8" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.8" cy="12" r="2" />
      <circle cx="11.2" cy="4" r="2" />
      <path d="M4.8 10V6.4A2.4 2.4 0 0 1 7.2 4h2" />
    </>
  ),
  merge: (
    <>
      <circle cx="4.4" cy="12" r="2" />
      <circle cx="11.6" cy="12" r="2" />
      <circle cx="11.6" cy="4" r="2" />
      <path d="M11.6 6v1.6a4.4 4.4 0 0 1-4.4 4.4H6.4" />
    </>
  ),
  'pull-request': (
    <>
      <circle cx="4" cy="12.4" r="2.1" />
      <circle cx="4" cy="3.6" r="2.1" />
      <path d="M4 5.7v4.6" />
      <circle cx="11.8" cy="12.4" r="2.1" />
      <path d="M11.8 10.3V6.4a2.2 2.2 0 0 0-2.2-2.2H8.3" />
      <path d="M10.1 2.2 8.1 4.2l2 2" />
    </>
  ),
  push: (
    <>
      <path d="M8 11.4V3.2" />
      <path d="M4.6 6.6 8 3.2l3.4 3.4" />
      <path d="M2.6 12.8h10.8" />
    </>
  ),
  pull: (
    <>
      <path d="M8 2.6v8.2" />
      <path d="M4.6 7.4 8 10.8l3.4-3.4" />
      <path d="M2.6 12.8h10.8" />
    </>
  ),
  checkout: (
    <>
      <path d="M13.4 8H3.6" />
      <path d="M6.8 4.8 3.4 8l3.4 3.2" />
      <path d="M13.4 4.8v6.4" />
    </>
  ),
  status: (
    <>
      <circle cx="4.2" cy="4.4" r="1.5" />
      <circle cx="4.2" cy="11.6" r="1.5" />
      <path d="M7.4 4.4h6M7.4 11.6h6" />
    </>
  ),
  diff: (
    <>
      <path d="M2.6 4.4h5M2.6 8h10.8M2.6 11.6h6.8" />
      <path d="M11 2.6v2.6M9.7 3.9h2.6" />
    </>
  ),
  log: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 4.8V8l2.4 1.6" />
    </>
  ),
  stash: (
    <>
      <path d="M2.4 6h11.2v7.2H2.4z" />
      <path d="M4.6 6V3.4h6.8V6" />
      <path d="M6.4 9h3.2" />
    </>
  ),
  tag: (
    <>
      <path d="M8.8 2.4h4.8v4.8l-6 6-4.8-4.8z" />
      <circle cx="11.4" cy="4.8" r="1" />
    </>
  ),
  clone: (
    <>
      <circle cx="5" cy="4" r="1.9" />
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="11.6" cy="8" r="1.9" />
      <path d="M5 5.9v4.2" />
      <path d="M6.9 4.4h2.2a2.4 2.4 0 0 1 2.2 1.6" />
      <path d="M6.9 11.6h2.2a2.4 2.4 0 0 0 2.2-1.6" />
    </>
  ),
  run: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M6.8 5.6 10.4 8l-3.6 2.4z" />
    </>
  ),
  issue: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  release: (
    <>
      <path d="M8.8 2.4h4.8v4.8l-6 6-4.8-4.8z" />
      <path d="M6.4 9.6 4.4 11.6" />
    </>
  ),
}

/** Pixel size the tool rows render leading glyphs at. */
const DEFAULT_SIZE = 14

/**
 * Render the glyph that names one Git or GitHub subcommand.
 * @param props.action - action derived from the shell command.
 * @param props.size - pixel size; the tool rows use its default.
 * @returns the icon, hidden from the accessibility tree like every row glyph.
 */
export function GitActionIcon({ action, size = DEFAULT_SIZE }: {
  readonly action: GitAction
  readonly size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-git-action={action}
    >
      {GLYPHS[action]}
    </svg>
  )
}
