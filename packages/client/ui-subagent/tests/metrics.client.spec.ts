/** Shared catalog metrics: USD precision tiers. */
import { describe, expect, it } from 'vitest'
import { formatUsd } from '../src/client/metrics.ts'

describe('formatUsd', () => {
  it('keeps sub-cent catalog costs readable', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1.234)).toBe('$1.23')
    expect(formatUsd(0.05)).toBe('$0.0500')
    expect(formatUsd(0.001234)).toBe('$0.0012')
    expect(formatUsd(1e-12)).toBe('$0.00000000')
  })
})
