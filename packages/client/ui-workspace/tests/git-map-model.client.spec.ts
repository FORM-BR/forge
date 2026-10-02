/**
 * Git Map geometry against fixed history: the coordinates of the main line,
 * merge curves, open branches and date brackets, the head marker, and the
 * legend counts. The numbers are the subway-map layout the tab draws.
 */
import { describe, expect, it } from 'vitest'
import type {
  WorkspaceGitGraph, WorkspaceGitGraphBranch, WorkspaceGitGraphCommit, WorkspaceGitGraphStation,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  NAME_LIMIT, defaultDayLabel, layoutGitMap, localDayLabel, truncateName,
} from '../src/client/git-map/model.ts'

function commit(id: string, type: WorkspaceGitGraphCommit['type'], date = '2026-01-10'): WorkspaceGitGraphCommit {
  return { hash: id.padEnd(40, '0'), short: id.slice(0, 7), type, message: `${type}: ${id}`, date, author: 'Ada' }
}

function station(
  id: string, kind: 'merge' | 'commit', type: WorkspaceGitGraphStation['type'], date: string,
  commits: readonly WorkspaceGitGraphCommit[] = [], commitCount = commits.length,
): WorkspaceGitGraphStation {
  return {
    hash: id.padEnd(40, '0'), short: id.slice(0, 7), kind, type, date, message: `msg ${id}`, author: 'Ada',
    label: kind === 'merge' ? '#7' : id.slice(0, 7), name: `name ${id}`, commits, commitCount,
  }
}

function branch(
  name: string, types: readonly WorkspaceGitGraphCommit['type'][], isHead = false, aliases = 0,
): WorkspaceGitGraphBranch {
  const commits = types.map((type, index) => commit(`${name}-${index}`, type))
  return { name, aliases, commits, commitCount: commits.length + (name === 'long' ? 2 : 0), isHead }
}

const FIRST = station('aaaaaaa', 'commit', 'feat', '2026-01-10')
const SECOND = station('bbbbbbb', 'merge', 'merge', '2026-01-10', [commit('b1', 'feat'), commit('b2', 'fix')], 5)
const THIRD = station('ccccccc', 'merge', 'merge', '2026-01-11', [commit('c1', 'other')])

function graph(overrides: Partial<WorkspaceGitGraph> = {}): WorkspaceGitGraph {
  return {
    repoName: 'repo', root: '/work/repo', base: 'main', head: THIRD.hash, headBranch: 'main', total: 20, merges: 2,
    stations: [FIRST, SECOND, THIRD],
    branches: [
      branch('long', ['feat', 'feat', 'feat', 'feat', 'feat', 'feat', 'feat', 'feat'], true, 1),
      branch('short', ['fix', 'other']),
    ],
    moreBranches: 1,
    ...overrides,
  }
}

describe('layoutGitMap', () => {
  it('places the main line, its stations and the canvas', () => {
    const layout = layoutGitMap(graph())
    // Two open branches plus the "not shown" note push the line down: 26 + 2 * 32 + 20 + 36.
    expect(layout.lineY).toBe(146)
    expect(layout.lineEnd).toBe(110 + 2 * 48)
    expect(layout.width).toBe(206 + 200 + 36)
    expect(layout.height).toBe(146 + 175)
    expect(layout.stations.map(item => [item.kind, item.x, item.y])).toEqual([
      ['commit', 110, 146], ['merge', 158, 146], ['merge', 206, 146],
    ])
    expect(layout.stations.map(item => item.label)).toEqual([
      { x: 110, y: 128, text: 'aaaaaaa', rotate: 0 },
      { x: 158, y: 128, text: '#7', rotate: 0 },
      { x: 206, y: 128, text: '#7', rotate: 0 },
    ])
    expect(layout.stations[0]!.name).toEqual({ x: 106, y: 196, text: 'name aaaaaaa', rotate: -38 })
  })

  it('draws a commit station as one dot and a merge station as a ring over a curve of its branch commits', () => {
    const [direct, merge, head] = layoutGitMap(graph()).stations
    expect(direct!.curve).toBeUndefined()
    expect(direct!.commits).toEqual([])
    expect(direct!.dot).toMatchObject({ x: 110, y: 146, r: 6.5, type: 'feat', isHead: false })
    expect(direct!.dot!.commit).toEqual({ hash: FIRST.hash, short: 'aaaaaaa', message: 'msg aaaaaaa', author: 'Ada' })

    expect(merge!.dot).toBeUndefined()
    expect(merge!.curve).toBe('M114 146 C116 176 120 176 124 176 H150 C154 176 156 171 158 146')
    expect(merge!.commits.map(dot => [dot.x, dot.y, dot.r, dot.type])).toEqual([[133, 176, 4.5, 'feat'], [143, 176, 4.5, 'fix']])
    expect(merge!.isHead).toBe(false)
    expect(merge!.station.commitCount).toBe(5)

    expect(head!.commits.map(dot => [dot.x, dot.type])).toEqual([[186, 'other']])
    expect(head!.isHead).toBe(true)
  })

  it('marks the checked-out commit wherever it is drawn', () => {
    const onDirect = layoutGitMap(graph({ head: FIRST.hash }))
    expect(onDirect.stations[0]!.dot!.isHead).toBe(true)
    expect(onDirect.stations[2]!.isHead).toBe(false)
    const onBranch = layoutGitMap(graph({ head: commit('short-1', 'other').hash }))
    expect(onBranch.branches[1]!.dots.map(dot => dot.isHead)).toEqual([false, true])
    expect(onBranch.stations.some(item => item.isHead)).toBe(false)
  })

  it('stacks open branches upward, newest commit at the right end, and counts what it leaves out', () => {
    const layout = layoutGitMap(graph())
    const [long, short] = layout.branches
    expect(long!.path).toBe('M206 146 C246 146 246 26 286 26 H406')
    expect(long!.dots).toHaveLength(8)
    expect(long!.dots.map(dot => dot.x)).toEqual([308, 322, 336, 350, 364, 378, 392, 406])
    expect(long!.dots.every(dot => dot.y === 26 && dot.r === 5)).toBe(true)
    // 10 commits on the branch, 8 drawn.
    expect(long!.extra).toBe(2)
    expect(long!.aliases).toBe(1)
    expect(long!.isHead).toBe(true)
    expect([long!.labelX, long!.labelY]).toEqual([296, 17])
    expect(short!.path).toBe('M206 146 C246 146 246 58 286 58 H406')
    expect(short!.dots.map(dot => [dot.x, dot.type])).toEqual([[392, 'fix'], [406, 'other']])
    expect(short!.extra).toBe(0)
    expect(short!.isHead).toBe(false)
    expect(layout.more).toEqual({ x: 406, y: 90, count: 1 })
  })

  it('draws only the newest eight commits of a long branch', () => {
    const many = branch('many', Array.from({ length: 12 }, () => 'other' as const))
    const layout = layoutGitMap(graph({ branches: [many], moreBranches: 0 }))
    expect(layout.branches[0]!.dots.map(dot => dot.commit.short)).toEqual(
      many.commits.slice(-8).map(entry => entry.short),
    )
    expect(layout.branches[0]!.extra).toBe(4)
    expect(layout.more).toBeUndefined()
  })

  it('groups consecutive stations of one day under one bracket', () => {
    const layout = layoutGitMap(graph())
    expect(layout.days).toEqual([
      { key: '2026-01-10@110', path: 'M90 281 V286 H176 V281', x: 133, y: 302, text: '10/01' },
      { key: '2026-01-11@206', path: 'M186 281 V286 H224 V281', x: 205, y: 302, text: '11/01' },
    ])
    expect(layoutGitMap(graph(), { dayLabel: iso => `<${iso}>` }).days.map(day => day.text))
      .toEqual(['<2026-01-10>', '<2026-01-11>'])
  })

  it('counts exactly the marks it draws for the legend', () => {
    // Direct commit (feat), merge commits (feat, fix, other), 8 feat dots on one branch, fix + other on the other.
    expect(layoutGitMap(graph()).counts).toEqual({ feat: 1 + 1 + 8, fix: 1 + 1, other: 1 + 1, merge: 2 })
    // A branch's commits beyond the eight drawn are not counted.
    const many = branch('many', Array.from({ length: 12 }, () => 'fix' as const))
    expect(layoutGitMap(graph({ stations: [FIRST], branches: [many], moreBranches: 0 })).counts)
      .toEqual({ feat: 1, fix: 8, other: 0, merge: 0 })
  })

  it('keeps the canvas at its minimum height without open branches', () => {
    const layout = layoutGitMap(graph({ branches: [], moreBranches: 0 }))
    expect(layout.lineY).toBe(110)
    expect(layout.more).toBeUndefined()
    expect(layout.branches).toEqual([])
  })

  it('handles a history with no station', () => {
    const layout = layoutGitMap(graph({ stations: [], branches: [], moreBranches: 0 }))
    expect(layout.lineEnd).toBe(110)
    expect(layout.stations).toEqual([])
    expect(layout.days).toEqual([])
    expect(layout.counts).toEqual({ feat: 0, fix: 0, other: 0, merge: 0 })
  })

  it('draws a plain commit that is not conventionally typed in the neutral class', () => {
    const plain = station('ddddddd', 'commit', 'other', '2026-02-01')
    expect(layoutGitMap(graph({ stations: [plain] })).stations[0]!.dot!.type).toBe('other')
  })
})

describe('Git Map labels', () => {
  it('cuts long station names with an ellipsis', () => {
    expect(truncateName('short')).toBe('short')
    expect(truncateName('x'.repeat(NAME_LIMIT))).toBe('x'.repeat(NAME_LIMIT))
    expect(truncateName('x'.repeat(NAME_LIMIT + 1))).toBe(`${'x'.repeat(NAME_LIMIT - 1)}…`)
  })

  it('formats dates as day and month', () => {
    expect(defaultDayLabel('2026-10-02')).toBe('02/10')
    expect(defaultDayLabel('garbage')).toBe('garbage')
    expect(localDayLabel('2026-10-02', 'pt-BR')).toBe('02/10')
    expect(localDayLabel('2026-10-02', 'en-US')).toBe('10/02')
    expect(localDayLabel('garbage')).toBe('garbage')
  })
})
