/**
 * Git Map geometry: a pure function from the Host's history to the coordinates
 * of every mark on the subway map. The component only turns these numbers into
 * SVG, so the layout can be checked against fixed data.
 *
 * The main line runs left to right with the newest station at the right. Each
 * merge station has a short curve below it holding up to three commits of the
 * merged branch; unmerged branches leave the end of the line as dashed curves
 * stacked upward, newest commits at the right end.
 */
import type {
  WorkspaceGitGraph, WorkspaceGitGraphCommit, WorkspaceGitGraphStation,
} from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Distance between consecutive stations on the main line. */
export const STATION_SPACING = 48
/** Left margin before the first station: room for its rotated name. */
export const PAD_LEFT = 110
/** Width of the stretch right of the last station that carries the open branches. */
export const BRANCH_RUN = 200
/** Right margin after the open branches. */
export const PAD_RIGHT = 36
/** Vertical position of the topmost open branch. */
export const BRANCH_TOP = 26
/** Vertical distance between open branches. */
export const BRANCH_STEP = 32
/** Distance between commit dots along an open branch. */
export const BRANCH_DOT_STEP = 14
/** Commits drawn per open branch. */
export const BRANCH_DOTS = 8
/** Station names are cut at this many characters. */
export const NAME_LIMIT = 22
/** Space below the main line for merge curves, rotated names, and the date row. */
export const BELOW_LINE = 175

/** Class of a commit dot; a merge is drawn as a ring instead. */
export type GitMapDotType = 'feat' | 'fix' | 'other'

/** The facts a dot's tooltip needs. */
export interface GitMapCommitInfo {
  readonly hash: string
  readonly short: string
  readonly message: string
  readonly author: string
}

/** One commit dot. */
export interface GitMapDot {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly r: number
  readonly type: GitMapDotType
  readonly commit: GitMapCommitInfo
  /** The checked-out commit: drawn with a ring around it. */
  readonly isHead: boolean
}

/** A text mark, optionally rotated about its own anchor point. */
export interface GitMapText {
  readonly x: number
  readonly y: number
  readonly text: string
  /** Degrees about (x, y); zero for none. */
  readonly rotate: number
}

/** One station on the main line. */
export interface GitMapStation {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly kind: 'merge' | 'commit'
  readonly station: WorkspaceGitGraphStation
  /** Pull-request number or abbreviated hash, above the line. */
  readonly label: GitMapText
  /** Merged branch (or subject), rotated below the line; the full text stays in `station.name`. */
  readonly name: GitMapText
  /** A merge's ring is the checked-out commit. */
  readonly isHead: boolean
  /** Path of the curve a merge's branch commits hang from. */
  readonly curve: string | undefined
  /** Newest commits of the merged branch, oldest first. */
  readonly commits: readonly GitMapDot[]
  /** The dot of a station that is a plain commit. */
  readonly dot: GitMapDot | undefined
}

/** One unmerged branch. */
export interface GitMapBranch {
  readonly key: string
  readonly name: string
  readonly path: string
  readonly dots: readonly GitMapDot[]
  /** Commits beyond the dots drawn. */
  readonly extra: number
  readonly aliases: number
  readonly isHead: boolean
  /** Where the name is written, right-aligned. */
  readonly labelX: number
  readonly labelY: number
}

/** The row of date brackets under the line. */
export interface GitMapDay {
  readonly key: string
  readonly path: string
  readonly x: number
  readonly y: number
  readonly text: string
}

/** Everything the component draws. */
export interface GitMapLayout {
  readonly width: number
  readonly height: number
  /** Vertical position of the main line. */
  readonly lineY: number
  /** Where the solid main line ends and its dotted continuation toward the branches begins. */
  readonly lineEnd: number
  readonly stations: readonly GitMapStation[]
  readonly branches: readonly GitMapBranch[]
  /** Where the "not shown" note is written, right-aligned; absent when no branch was left out. */
  readonly more: { readonly x: number; readonly y: number; readonly count: number } | undefined
  readonly days: readonly GitMapDay[]
  /** Marks actually drawn, by kind, for the legend. */
  readonly counts: Readonly<Record<GitMapDotType | 'merge', number>>
}

/** Options of {@link layoutGitMap}. */
export interface GitMapOptions {
  /**
   * Format a `YYYY-MM-DD` date for the row under the line. Dates are also the
   * grouping key, so this must be injective.
   */
  readonly dayLabel?: (isoDate: string) => string
}

/**
 * Default date label: day and month, as `dd/mm`.
 * @param isoDate - `YYYY-MM-DD`.
 * @returns `dd/mm`, or the input when it is not an ISO date.
 */
export function defaultDayLabel(isoDate: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(isoDate)
  return match === null ? isoDate : `${match[2]}/${match[1]}`
}

/**
 * Cut a station name at {@link NAME_LIMIT} characters.
 * @param text - full name.
 * @returns the name, ending in an ellipsis when it was cut.
 */
export function truncateName(text: string): string {
  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text
}

function info(commit: WorkspaceGitGraphCommit | WorkspaceGitGraphStation): GitMapCommitInfo {
  return { hash: commit.hash, short: commit.short, message: commit.message, author: commit.author }
}

/**
 * Lay the Host's history out as a subway map.
 * @param graph - the Host's answer for one repository.
 * @param options - presentation hooks.
 * @returns every coordinate the component draws, plus the legend counts.
 */
export function layoutGitMap(graph: WorkspaceGitGraph, options: GitMapOptions = {}): GitMapLayout {
  const dayLabel = options.dayLabel ?? defaultDayLabel
  const counts: Record<GitMapDotType | 'merge', number> = { feat: 0, fix: 0, other: 0, merge: 0 }
  const dotFor = (
    key: string, x: number, y: number, r: number, type: GitMapDotType, commit: GitMapCommitInfo,
  ): GitMapDot => {
    counts[type]++
    return { key, x, y, r, type, commit, isHead: commit.hash === graph.head }
  }

  const open = graph.branches
  const hasMore = graph.moreBranches > 0
  const lineY = Math.max(110, BRANCH_TOP + open.length * BRANCH_STEP + (hasMore ? 20 : 0) + 36)
  const lineEnd = PAD_LEFT + Math.max(graph.stations.length - 1, 0) * STATION_SPACING
  const runEnd = lineEnd + BRANCH_RUN
  const reach = STATION_SPACING - 4

  const days: { date: string; first: number; last: number }[] = []
  const stations = graph.stations.map((station, index): GitMapStation => {
    const x = PAD_LEFT + index * STATION_SPACING
    const lastDay = days[days.length - 1]
    if (lastDay !== undefined && lastDay.date === station.date) lastDay.last = x
    else days.push({ date: station.date, first: x, last: x })

    const merge = station.kind === 'merge'
    let curve: string | undefined
    let commits: GitMapDot[] = []
    let dot: GitMapDot | undefined
    if (merge) {
      const bottom = lineY + 30
      curve = `M${x - reach} ${lineY} C${x - reach + 2} ${bottom} ${x - reach + 6} ${bottom} ${x - reach + 10} ${bottom}`
        + ` H${x - 8} C${x - 4} ${bottom} ${x - 2} ${lineY + 25} ${x} ${lineY}`
      const count = station.commits.length
      commits = station.commits.map((commit, at) => dotFor(
        `${station.hash}:${commit.hash}`, x - 20 + (at - (count - 1) / 2) * 10, bottom, 4.5, commit.type, info(commit),
      ))
      counts.merge++
    } else {
      dot = dotFor(station.hash, x, lineY, 6.5, station.type === 'merge' ? 'other' : station.type, info(station))
    }
    return {
      key: station.hash,
      x,
      y: lineY,
      kind: station.kind,
      station,
      label: { x, y: lineY - 18, text: station.label, rotate: 0 },
      name: { x: x - 4, y: lineY + 50, text: truncateName(station.name), rotate: -38 },
      isHead: merge && station.hash === graph.head,
      curve,
      commits,
      dot,
    }
  })

  const branches = open.map((branch, index): GitMapBranch => {
    const y = BRANCH_TOP + index * BRANCH_STEP
    const shown = branch.commits.slice(-BRANCH_DOTS)
    const dots = shown.map((commit, at) => dotFor(
      `${branch.name}:${commit.hash}`, runEnd - (shown.length - 1 - at) * BRANCH_DOT_STEP, y, 5, commit.type, info(commit),
    ))
    return {
      key: branch.name,
      name: branch.name,
      path: `M${lineEnd} ${lineY} C${lineEnd + 40} ${lineY} ${lineEnd + 40} ${y} ${lineEnd + 80} ${y} H${runEnd}`,
      dots,
      extra: Math.max(0, branch.commitCount - shown.length),
      aliases: branch.aliases,
      isHead: branch.isHead,
      labelX: runEnd - Math.max(shown.length - 1, 0) * BRANCH_DOT_STEP - 12,
      labelY: y - 9,
    }
  })

  const bracketY = lineY + 140
  const dayMarks = days.map((day): GitMapDay => {
    const left = day.first - STATION_SPACING / 2 + 4
    const right = day.last + STATION_SPACING / 2 - 6
    return {
      key: `${day.date}@${day.first}`,
      path: `M${left} ${bracketY - 5} V${bracketY} H${right} V${bracketY - 5}`,
      x: (left + right) / 2,
      y: bracketY + 16,
      text: dayLabel(day.date),
    }
  })

  return {
    width: runEnd + PAD_RIGHT,
    height: lineY + BELOW_LINE,
    lineY,
    lineEnd,
    stations,
    branches,
    more: hasMore ? { x: runEnd, y: BRANCH_TOP + open.length * BRANCH_STEP, count: graph.moreBranches } : undefined,
    days: dayMarks,
    counts,
  }
}

/**
 * Format a `YYYY-MM-DD` date as day and month in the reader's own order and separators.
 * @param isoDate - `YYYY-MM-DD`.
 * @param locale - BCP 47 tag; defaults to the runtime's locale.
 * @returns the localized day and month, or the input when it is not an ISO date.
 */
export function localDayLabel(isoDate: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (match === null) return isoDate
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(instant)
}
