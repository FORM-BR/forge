/**
 * Geometry of the model menu card's corner resize. Pure functions over
 * viewport-space rectangles: the drag opposite the grabbed corner stays fixed,
 * and every result keeps the card inside the viewport margin.
 */

/** A card rectangle in viewport pixels. */
export interface MenuRect {
  left: number
  top: number
  width: number
  height: number
}

/** The four corners a resize can grab: north/south then west/east. */
export type MenuCorner = 'nw' | 'ne' | 'sw' | 'se'

/** Viewport inset the card keeps on every side. */
export const MENU_MARGIN = 12

/** Smallest card that still shows a heading, one row and the corner grips. */
export const MENU_MIN = { width: 240, height: 160 } as const

/** Largest card, however big the window is. */
export const MENU_MAX = { width: 720, height: 720 } as const

/** Clamp `value` into `[min, max]`; `min` wins when the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * Fit a stored card size to the current viewport.
 * @param size - the size to fit, in pixels.
 * @param viewport - the viewport size, in pixels.
 * @returns the size clamped to the minimum, the maximum and the viewport margin.
 */
export function fitMenuSize(
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: clamp(size.width, MENU_MIN.width, Math.min(MENU_MAX.width, viewport.width - 2 * MENU_MARGIN)),
    height: clamp(size.height, MENU_MIN.height, Math.min(MENU_MAX.height, viewport.height - 2 * MENU_MARGIN)),
  }
}

/**
 * Resize one axis from a grabbed edge, keeping the opposite edge in place.
 * @param start - the card's start position and length on this axis.
 * @param delta - the pointer movement along this axis.
 * @param grabbedFar - whether the far edge (right/bottom) is the one dragged.
 * @param room - the viewport length on this axis.
 * @param limits - the minimum and maximum card length on this axis.
 * @returns the new position and length on this axis.
 */
function resizeAxis(
  start: { position: number; length: number },
  delta: number,
  grabbedFar: boolean,
  room: number,
  limits: { min: number; max: number },
): { position: number; length: number } {
  if (grabbedFar) {
    const length = clamp(start.length + delta, limits.min, Math.min(limits.max, room - MENU_MARGIN - start.position))
    return { position: start.position, length }
  }
  const far = start.position + start.length
  const length = clamp(start.length - delta, limits.min, Math.min(limits.max, far - MENU_MARGIN))
  return { position: far - length, length }
}

/**
 * Resize the card by dragging one corner.
 * @param corner - the grabbed corner.
 * @param start - the card rectangle when the drag began.
 * @param delta - pointer movement since the drag began.
 * @param viewport - the viewport size.
 * @returns the resized rectangle; the corner opposite the grabbed one does not move.
 */
export function resizeMenuRect(
  corner: MenuCorner,
  start: MenuRect,
  delta: { x: number; y: number },
  viewport: { width: number; height: number },
): MenuRect {
  const horizontal = resizeAxis(
    { position: start.left, length: start.width }, delta.x, corner.endsWith('e'), viewport.width,
    { min: MENU_MIN.width, max: MENU_MAX.width },
  )
  const vertical = resizeAxis(
    { position: start.top, length: start.height }, delta.y, corner.startsWith('s'), viewport.height,
    { min: MENU_MIN.height, max: MENU_MAX.height },
  )
  return { left: horizontal.position, top: vertical.position, width: horizontal.length, height: vertical.length }
}
