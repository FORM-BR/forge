import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-locale-pt node plugin', () => {
  it('mounts no host-side behavior', () => {
    expect(apply()).toBeUndefined()
  })
})
