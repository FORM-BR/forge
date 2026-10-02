import { describe, expect, it } from 'vitest'
import { abbreviatePath, PATH_LABEL_MAX } from '../src/client/status/path-label.ts'

describe('abbreviatePath', () => {
  it('returns a path that fits unchanged', () => {
    expect(abbreviatePath('C:\\Users\\Felipe\\Dev\\repo')).toBe('C:\\Users\\Felipe\\Dev\\repo')
    expect(abbreviatePath('/home/a/repo')).toBe('/home/a/repo')
  })

  it('keeps the trailing segments of a long POSIX path behind an ellipsis', () => {
    const label = abbreviatePath('/home/someone/projects/clients/acme/services/billing-api', 30)
    expect(label).toBe('…/acme/services/billing-api')
    expect(label.length).toBeLessThanOrEqual(30)
  })

  it('keeps backslashes for a long Windows path and drops the drive prefix', () => {
    const label = abbreviatePath('C:\\Users\\Felipe\\Dev\\forge-features\\status-bar\\packages', 36)
    expect(label).toBe('…\\forge-features\\status-bar\\packages')
    expect(label.length).toBeLessThanOrEqual(36)
  })

  it('returns an over-long last segment whole for the CSS ellipsis to clip', () => {
    const last = 'x'.repeat(PATH_LABEL_MAX + 10)
    expect(abbreviatePath(`/a/b/${last}`)).toBe(`…/${last}`)
  })

  it('treats a mixed-separator path as POSIX-style', () => {
    expect(abbreviatePath('C:\\very\\long/mixed/path/with/many/segments/that/overflow/the/budget', 24))
      .toBe('…/overflow/the/budget')
  })
})
