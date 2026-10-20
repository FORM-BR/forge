// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningForgeMark } from '../src/client/chat/RunningForgeMark.tsx'

afterEach(cleanup)

describe('RunningForgeMark', () => {
  it('draws the anvil, the FORGE logo hammer and the impact sparks', () => {
    const view = render(<RunningForgeMark />)
    expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
    expect(view.container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 32 32')
    expect(view.container.querySelector('[data-forge-anvil]')).not.toBeNull()
    const hammer = view.container.querySelector('[data-forge-hammer]')
    expect(hammer?.querySelectorAll('path')).toHaveLength(2)
    expect(hammer?.querySelectorAll('polyline')).toHaveLength(2)
    expect(hammer?.querySelector('polyline')?.getAttribute('points')).toBe('126.55,38 186.3,97.75 150.41,133.64')
    expect(view.container.querySelectorAll('[data-forge-sparks] line')).toHaveLength(4)
    expect(view.container.querySelectorAll('[data-forge-sparks] circle')).toHaveLength(2)
  })

  it('leaves the poses to the stylesheet instead of SMIL', () => {
    const view = render(<RunningForgeMark />)
    expect(view.container.querySelector('animate')).toBeNull()
  })
})
