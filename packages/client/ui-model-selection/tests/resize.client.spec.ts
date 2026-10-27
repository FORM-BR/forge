import { describe, expect, it } from 'vitest'
import { fitMenuSize, MENU_MARGIN, resizeMenuRect } from '../src/client/resize.ts'

const viewport = { width: 1000, height: 800 }
const start = { left: 400, top: 200, width: 300, height: 400 }

describe('fitMenuSize', () => {
  it('keeps an in-range size', () => {
    expect(fitMenuSize({ width: 400, height: 300 }, viewport)).toEqual({ width: 400, height: 300 })
  })

  it('raises a small size to the minimum and lowers a large one to the maximum', () => {
    expect(fitMenuSize({ width: 10, height: 10 }, viewport)).toEqual({ width: 240, height: 160 })
    expect(fitMenuSize({ width: 5000, height: 5000 }, { width: 3000, height: 3000 })).toEqual({ width: 720, height: 720 })
  })

  it('never exceeds the viewport margin', () => {
    expect(fitMenuSize({ width: 700, height: 700 }, { width: 500, height: 400 }))
      .toEqual({ width: 500 - 2 * MENU_MARGIN, height: 400 - 2 * MENU_MARGIN })
  })
})

describe('resizeMenuRect', () => {
  it('moves the top-left corner and keeps the bottom-right fixed', () => {
    expect(resizeMenuRect('nw', start, { x: -50, y: -30 }, viewport))
      .toEqual({ left: 350, top: 170, width: 350, height: 430 })
  })

  it('moves the bottom-right corner and keeps the top-left fixed', () => {
    expect(resizeMenuRect('se', start, { x: 40, y: 60 }, viewport))
      .toEqual({ left: 400, top: 200, width: 340, height: 460 })
  })

  it('handles the two mixed corners', () => {
    expect(resizeMenuRect('ne', start, { x: 20, y: -20 }, viewport))
      .toEqual({ left: 400, top: 180, width: 320, height: 420 })
    expect(resizeMenuRect('sw', start, { x: -20, y: 20 }, viewport))
      .toEqual({ left: 380, top: 200, width: 320, height: 420 })
  })

  it('stops at the minimum size without moving the fixed edge', () => {
    expect(resizeMenuRect('nw', start, { x: 500, y: 500 }, viewport))
      .toEqual({ left: 460, top: 440, width: 240, height: 160 })
  })

  it('stops at the viewport margin on the grabbed side', () => {
    expect(resizeMenuRect('nw', start, { x: -900, y: -900 }, viewport))
      .toEqual({ left: MENU_MARGIN, top: MENU_MARGIN, width: 700 - MENU_MARGIN, height: 600 - MENU_MARGIN })
    expect(resizeMenuRect('se', start, { x: 900, y: 900 }, viewport))
      .toEqual({ left: 400, top: 200, width: 1000 - MENU_MARGIN - 400, height: 800 - MENU_MARGIN - 200 })
  })

  it('stops at the maximum size in a large window', () => {
    expect(resizeMenuRect('se', start, { x: 5000, y: 5000 }, { width: 9000, height: 9000 }))
      .toEqual({ left: 400, top: 200, width: 720, height: 720 })
  })
})
