// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConstellationCanvas } from '../src/constellation/ConstellationCanvas.tsx'
import { addPulse, createScene, drawScene, stepScene } from '../src/constellation/engine.ts'

vi.mock('../src/constellation/engine.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/constellation/engine.ts')>()
  return {
    ...actual,
    addPulse: vi.fn(actual.addPulse),
    createScene: vi.fn(actual.createScene),
    drawScene: vi.fn(actual.drawScene),
    stepScene: vi.fn(actual.stepScene),
  }
})

/** Observer double: remembers its callback and what it was asked to watch. */
class ObserverDouble {
  readonly callback: () => void
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(callback: () => void) {
    this.callback = callback
  }
}
class ResizeDouble extends ObserverDouble {
  static instances: ObserverDouble[] = []
  constructor(callback: () => void) {
    super(callback)
    ResizeDouble.instances.push(this)
  }
}
class MutationDouble extends ObserverDouble {
  static instances: ObserverDouble[] = []
  constructor(callback: () => void) {
    super(callback)
    MutationDouble.instances.push(this)
  }
}

const env = {
  reduced: false,
  visible: true,
  width: 400,
  height: 300,
  color: 'rgb(1, 2, 3)',
  caret: 'rgb(4, 5, 6)',
}
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
const raf = vi.fn((callback: FrameRequestCallback) => {
  nextFrame += 1
  frames.set(nextFrame, callback)
  return nextFrame
})
const caf = vi.fn((id: number) => { frames.delete(id) })
const ctx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 0,
}
const getContext = vi.fn<() => typeof ctx | null>(() => ctx)

/** Run every pending animation frame callback as if the clock read `now`. */
function flush(now: number) {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}

function defineOn(target: object, name: string, descriptor: PropertyDescriptor) {
  Object.defineProperty(target, name, { configurable: true, ...descriptor })
}

function mount(className?: string) {
  const view = render(<div data-testid="host"><ConstellationCanvas className={className} /></div>)
  const canvas = view.container.querySelector('canvas') as HTMLCanvasElement
  const host = canvas.parentElement as HTMLElement
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300, toJSON: () => ({}),
  })
  return { view, canvas, host }
}

function lastStep() {
  return vi.mocked(stepScene).mock.calls.at(-1)
}
function lastDraw() {
  return vi.mocked(drawScene).mock.calls.at(-1)
}
function move(host: Element, x: number, y: number) {
  const event = new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })
  host.dispatchEvent(event)
  return event
}

beforeEach(() => {
  env.reduced = false
  env.visible = true
  env.width = 400
  env.height = 300
  env.color = 'rgb(1, 2, 3)'
  env.caret = 'rgb(4, 5, 6)'
  frames.clear()
  nextFrame = 0
  ResizeDouble.instances = []
  MutationDouble.instances = []
  vi.clearAllMocks()
  getContext.mockImplementation(() => ctx)
  document.body.setAttribute('data-dsh-motion', 'full')
  defineOn(HTMLCanvasElement.prototype, 'getContext', { value: getContext })
  defineOn(HTMLCanvasElement.prototype, 'clientWidth', { get: () => env.width })
  defineOn(HTMLCanvasElement.prototype, 'clientHeight', { get: () => env.height })
  defineOn(document, 'visibilityState', { get: () => (env.visible ? 'visible' : 'hidden') })
  defineOn(window, 'devicePixelRatio', { value: 1, writable: true })
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)
  vi.stubGlobal('ResizeObserver', ResizeDouble)
  vi.stubGlobal('MutationObserver', MutationDouble)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: env.reduced })))
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({ color: env.color, caretColor: env.caret })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight')
  Reflect.deleteProperty(document, 'visibilityState')
  document.body.removeAttribute('data-dsh-motion')
})

describe('ConstellationCanvas', () => {
  it('renders an aria-hidden canvas carrying the owner class', () => {
    const { canvas } = mount('owner')
    expect(canvas.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.classList.contains('owner')).toBe(true)
  })

  it('does nothing when the canvas has no 2d context', () => {
    getContext.mockImplementation(() => null)
    const { view } = mount()
    expect(getContext).toHaveBeenCalledWith('2d')
    expect(ResizeDouble.instances).toHaveLength(0)
    expect(MutationDouble.instances).toHaveLength(0)
    expect(raf).not.toHaveBeenCalled()
    expect(() => { view.unmount() }).not.toThrow()
  })

  it('sizes the backing store with the capped pixel ratio and builds a scene', () => {
    window.devicePixelRatio = 3
    const { canvas } = mount()
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(450)
    expect(ctx.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0)
    expect(createScene).toHaveBeenCalledWith(400, 300, Math.random)
  })

  it('never drops the pixel ratio below one', () => {
    window.devicePixelRatio = 0.5
    const { canvas } = mount()
    expect(canvas.width).toBe(400)
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
  })

  it('animates with motion full, no reduced motion and a visible tab', () => {
    mount()
    expect(drawScene).not.toHaveBeenCalled()
    expect(frames.size).toBe(1)
    flush(1000)
    expect(lastStep()?.[1]).toBe(0)
    expect(lastStep()?.[2]).toBeNull()
    expect(lastDraw()?.[3]).toEqual({ ink: [1, 2, 3], dot: [4, 5, 6] })
    flush(1016)
    expect(lastStep()?.[1]).toBeCloseTo(0.016, 9)
    expect(frames.size).toBe(1)
    flush(3000)
    expect(lastStep()?.[1]).toBe(0.05)
  })

  it('falls back to default colors when the computed colors are not parseable', () => {
    env.color = ''
    env.caret = 'transparent'
    mount()
    flush(1000)
    expect(lastDraw()?.[3]).toEqual({ ink: [120, 140, 160], dot: [150, 160, 170] })
  })

  it.each([['indicator'], ['off']])('paints one still frame when motion is %s', (motion) => {
    document.body.setAttribute('data-dsh-motion', motion)
    mount()
    expect(raf).not.toHaveBeenCalled()
    expect(drawScene).toHaveBeenCalledTimes(1)
    expect(lastDraw()?.[2]).toBeNull()
  })

  it('paints one still frame when motion is unset', () => {
    document.body.removeAttribute('data-dsh-motion')
    mount()
    expect(raf).not.toHaveBeenCalled()
    expect(drawScene).toHaveBeenCalledTimes(1)
  })

  it('paints one still frame under reduced motion', () => {
    env.reduced = true
    mount()
    expect(raf).not.toHaveBeenCalled()
    expect(drawScene).toHaveBeenCalledTimes(1)
  })

  it('paints one still frame while the tab is hidden and resumes when it shows', () => {
    env.visible = false
    mount()
    expect(raf).not.toHaveBeenCalled()
    expect(drawScene).toHaveBeenCalledTimes(1)
    env.visible = true
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frames.size).toBe(1)
    flush(1000)
    expect(stepScene).toHaveBeenCalledTimes(1)
  })

  it('stops the loop when the tab hides', () => {
    mount()
    const id = nextFrame
    env.visible = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(caf).toHaveBeenCalledWith(id)
    expect(frames.size).toBe(0)
    expect(drawScene).toHaveBeenCalledTimes(1)
  })

  it('follows the pointer in the canvas box and forgets it on leave', () => {
    const { host } = mount()
    move(host, 120, 90)
    flush(1000)
    expect(lastStep()?.[2]).toEqual({ x: 110, y: 70 })
    expect(lastDraw()?.[2]).toEqual({ x: 110, y: 70 })
    host.dispatchEvent(new MouseEvent('pointerleave'))
    flush(1016)
    expect(lastStep()?.[2]).toBeNull()
  })

  it('sends a pulse for a press on free space and not on a control', () => {
    const { host } = mount()
    const button = document.createElement('button')
    host.append(button)
    button.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, bubbles: true }))
    expect(addPulse).not.toHaveBeenCalled()
    host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, bubbles: true }))
    expect(addPulse).toHaveBeenCalledTimes(1)
    expect(addPulse).toHaveBeenCalledWith(expect.anything(), 40, 40)
  })

  it('treats a press whose target is not an element as free space', () => {
    const { host } = mount()
    const text = document.createTextNode('x')
    host.append(text)
    text.dispatchEvent(new MouseEvent('pointerdown', { clientX: 30, clientY: 40, bubbles: true }))
    expect(addPulse).toHaveBeenCalledWith(expect.anything(), 20, 20)
  })

  it('ignores presses while only a still frame is painted', () => {
    document.body.setAttribute('data-dsh-motion', 'off')
    const { host } = mount()
    host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, bubbles: true }))
    expect(addPulse).not.toHaveBeenCalled()
  })

  it('ignores presses while the box has no size', () => {
    env.width = 0
    env.height = 0
    const { host } = mount()
    host.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 60, bubbles: true }))
    expect(addPulse).not.toHaveBeenCalled()
  })

  it('skips every other frame after five idle seconds and allows a longer step', () => {
    mount()
    flush(1000)
    expect(stepScene).toHaveBeenCalledTimes(1)
    // 6000 ms without input: the first idle frame is skipped, the next one steps.
    flush(6000)
    expect(stepScene).toHaveBeenCalledTimes(1)
    flush(6500)
    expect(stepScene).toHaveBeenCalledTimes(2)
    expect(lastStep()?.[1]).toBe(0.1)
    flush(7000)
    expect(stepScene).toHaveBeenCalledTimes(2)
  })

  it('paints every frame again after pointer input', () => {
    const { host } = mount()
    flush(1000)
    flush(6000)
    const event = move(host, 120, 90)
    flush(event.timeStamp + 16)
    flush(event.timeStamp + 32)
    expect(stepScene).toHaveBeenCalledTimes(3)
    expect(lastStep()?.[1]).toBeCloseTo(0.016, 9)
  })

  it('does not build a scene for an empty box and builds one when it grows', () => {
    env.width = 0
    env.height = 0
    const { canvas } = mount()
    expect(createScene).not.toHaveBeenCalled()
    expect(raf).not.toHaveBeenCalled()
    expect(drawScene).not.toHaveBeenCalled()
    expect(ResizeDouble.instances[0]?.observe).toHaveBeenCalledWith(canvas)
    env.width = 400
    env.height = 300
    ResizeDouble.instances[0]?.callback()
    expect(createScene).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(1)
  })

  it('rebuilds the scene on resize, ignores identical sizes and stops when the box empties', () => {
    mount()
    const id = nextFrame
    const resize = ResizeDouble.instances[0]
    resize?.callback()
    expect(createScene).toHaveBeenCalledTimes(1)
    expect(raf).toHaveBeenCalledTimes(1)
    env.width = 500
    resize?.callback()
    expect(createScene).toHaveBeenCalledTimes(2)
    expect(createScene).toHaveBeenLastCalledWith(500, 300, Math.random)
    expect(caf).toHaveBeenCalledWith(id)
    expect(raf).toHaveBeenCalledTimes(2)
    env.width = 0
    env.height = 0
    resize?.callback()
    expect(frames.size).toBe(0)
    expect(createScene).toHaveBeenCalledTimes(2)
  })

  it('watches the Look and theme attributes on the body', () => {
    mount()
    const mutation = MutationDouble.instances[0]
    expect(mutation?.observe).toHaveBeenCalledWith(document.body, {
      attributes: true,
      attributeFilter: ['data-dsh-motion', 'data-dsh-accent', 'data-dsh-palette', 'data-ds-dark-theme'],
    })
  })

  it('stops animating and repaints when motion turns off, and resumes when it turns on', () => {
    mount()
    const id = nextFrame
    document.body.setAttribute('data-dsh-motion', 'off')
    MutationDouble.instances[0]?.callback()
    expect(caf).toHaveBeenCalledWith(id)
    expect(frames.size).toBe(0)
    expect(drawScene).toHaveBeenCalledTimes(1)
    document.body.setAttribute('data-dsh-motion', 'full')
    MutationDouble.instances[0]?.callback()
    expect(frames.size).toBe(1)
  })

  it('rereads the colors when the accent changes', () => {
    document.body.setAttribute('data-dsh-motion', 'off')
    mount()
    expect(lastDraw()?.[3].ink).toEqual([1, 2, 3])
    env.color = 'color(srgb 1 0 0)'
    MutationDouble.instances[0]?.callback()
    expect(lastDraw()?.[3].ink).toEqual([255, 0, 0])
  })

  it('cleans up everything on unmount', () => {
    const { view, host } = mount()
    const id = nextFrame
    const removeHost = vi.spyOn(host, 'removeEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    view.unmount()
    expect(caf).toHaveBeenCalledWith(id)
    expect(frames.size).toBe(0)
    expect(ResizeDouble.instances[0]?.disconnect).toHaveBeenCalled()
    expect(MutationDouble.instances[0]?.disconnect).toHaveBeenCalled()
    expect(removeHost.mock.calls.map(call => call[0])).toEqual(['pointermove', 'pointerleave', 'pointerdown'])
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('cleans up without cancelling a frame when only a still frame was painted', () => {
    document.body.setAttribute('data-dsh-motion', 'off')
    const { view } = mount()
    view.unmount()
    expect(caf).not.toHaveBeenCalled()
    expect(ResizeDouble.instances[0]?.disconnect).toHaveBeenCalled()
  })
})
