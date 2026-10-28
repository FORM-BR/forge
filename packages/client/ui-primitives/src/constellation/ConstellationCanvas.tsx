/**
 * Decorative constellation canvas that fills its positioned parent. The
 * parent's pointer moves pull nearby nodes and tilt the dust; a press on the
 * parent outside a control sends a pulse. Animation runs only while the page
 * is visible, `body[data-dsh-motion]` is `full`, and the system does not ask
 * for reduced motion; otherwise one still frame is painted. Hiding the canvas
 * with `display: none` stops all work (its box collapses to zero).
 */
import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { addPulse, createScene, drawScene, parseRgb, stepScene, type Scene, type ScenePalette, type ScenePointer } from './engine.ts'
import css from './ConstellationCanvas.module.css'

/** Props of the constellation canvas. */
export interface ConstellationCanvasProps {
  /** Placement class from the owner (position, inset, z-index, visibility rules). */
  className?: string | undefined
}

const MAX_DPR = 1.5
const MAX_FRAME_SECONDS = 0.05
/** After this many idle seconds without pointer input the loop paints every other frame. */
const IDLE_SECONDS = 5
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const OBSERVED_ATTRIBUTES = ['data-dsh-motion', 'data-dsh-accent', 'data-dsh-palette', 'data-ds-dark-theme']
const INTERACTIVE = 'button, a, input, textarea, select, label, [contenteditable], [role="button"], [role="menuitem"]'
const FALLBACK: ScenePalette = { ink: [120, 140, 160], dot: [150, 160, 170] }

/**
 * Render the constellation canvas.
 * @param props - placement class.
 * @returns the aria-hidden canvas element.
 */
export function ConstellationCanvas({ className }: ConstellationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    /* v8 ignore next -- the ref is attached before effects run */
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    /* v8 ignore next -- React mounts the canvas under a parent element */
    const host = canvas.parentElement ?? canvas

    let scene: Scene | null = null
    let width = 0
    let height = 0
    let pointer: ScenePointer | null = null
    let palette = FALLBACK
    let frame = 0
    let running = false
    let lastInput = 0

    const stop = () => {
      if (running) cancelAnimationFrame(frame)
      running = false
    }
    const readPalette = () => {
      // `color` carries the line ink and `caret-color` the dot tone; both
      // resolve theme variables in the stylesheet.
      const style = getComputedStyle(canvas)
      palette = { ink: parseRgb(style.color, FALLBACK.ink), dot: parseRgb(style.caretColor, FALLBACK.dot) }
    }
    const measure = (): boolean => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === width && h === height) return false
      width = w
      height = h
      if (w <= 0 || h <= 0) {
        scene = null
        return true
      }
      const dpr = Math.min(Math.max(window.devicePixelRatio, 1), MAX_DPR)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scene = createScene(w, h, Math.random)
      return true
    }
    const sync = () => {
      stop()
      const current = scene
      if (current === null) return
      readPalette()
      const animated = document.body.getAttribute('data-dsh-motion') === 'full'
        && !window.matchMedia(REDUCED_MOTION).matches
        && document.visibilityState === 'visible'
      if (!animated) {
        drawScene(ctx, current, null, palette)
        return
      }
      let last: number | null = null
      let skip = false
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick)
        const idle = now - lastInput > IDLE_SECONDS * 1000
        skip = idle && !skip
        if (skip) return
        const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME_SECONDS * (idle ? 2 : 1))
        last = now
        stepScene(current, dt, pointer)
        drawScene(ctx, current, pointer, palette)
      }
      running = true
      frame = requestAnimationFrame(tick)
    }

    const toLocal = (event: PointerEvent): ScenePointer => {
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    const onMove = (event: PointerEvent) => {
      pointer = toLocal(event)
      lastInput = event.timeStamp
    }
    const onLeave = () => { pointer = null }
    const onDown = (event: PointerEvent) => {
      const target = event.target
      if (scene === null || !running || (target instanceof Element && target.closest(INTERACTIVE) !== null)) return
      const at = toLocal(event)
      addPulse(scene, at.x, at.y)
      lastInput = event.timeStamp
    }
    const onVisibility = () => { sync() }
    const resizeObserver = new ResizeObserver(() => {
      if (measure()) sync()
    })
    const mutationObserver = new MutationObserver(sync)

    resizeObserver.observe(canvas)
    mutationObserver.observe(document.body, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES })
    host.addEventListener('pointermove', onMove, { passive: true })
    host.addEventListener('pointerleave', onLeave, { passive: true })
    host.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    measure()
    sync()

    return () => {
      stop()
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      host.removeEventListener('pointerdown', onDown)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} className={clsx(css.canvas, className)} aria-hidden="true" />
}
