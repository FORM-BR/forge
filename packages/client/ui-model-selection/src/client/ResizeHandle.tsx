/**
 * ResizeHandle: one corner grip of the model menu card. Pointer capture keeps
 * the drag live outside the card; the owner receives movement relative to the
 * pointer-down point and the end of the gesture.
 */
import { useRef, type PointerEvent } from 'react'
import clsx from 'clsx'
import type { MenuCorner } from './resize.ts'
import css from './ModelSelect.module.css'

/** Placement class of each corner. */
const CORNER_CLASS: Readonly<Record<MenuCorner, string | undefined>> = {
  nw: css.resizeNw, ne: css.resizeNe, sw: css.resizeSw, se: css.resizeSe,
}

/** Grip props: the corner it sits on and the owner's gesture callbacks. */
interface ResizeHandleProps {
  corner: MenuCorner
  /** Hover tooltip, already localized. */
  label: string
  /** Called once when a primary-button drag starts. */
  onStart: () => void
  /** Called on every pointer move with the movement since the start. */
  onDrag: (dx: number, dy: number) => void
  /** Called when the gesture ends or is cancelled. */
  onEnd: () => void
}

/**
 * Render one corner grip.
 * @param props - the corner, its label and the gesture callbacks.
 * @returns the grip element.
 */
export function ResizeHandle({ corner, label, onStart, onDrag, onEnd }: ResizeHandleProps) {
  const origin = useRef<{ id: number; x: number; y: number } | null>(null)

  const finish = (event: PointerEvent<HTMLDivElement>): void => {
    if (origin.current?.id !== event.pointerId) return
    origin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    onEnd()
  }

  return (
    <div
      className={clsx(css.resizeHandle, CORNER_CLASS[corner])}
      title={label}
      data-corner={corner}
      onPointerDown={(event) => {
        if (event.button !== 0 || origin.current !== null) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        origin.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        onStart()
      }}
      onPointerMove={(event) => {
        if (origin.current?.id !== event.pointerId) return
        onDrag(event.clientX - origin.current.x, event.clientY - origin.current.y)
      }}
      onPointerUp={(event) => {
        if (origin.current?.id !== event.pointerId) return
        onDrag(event.clientX - origin.current.x, event.clientY - origin.current.y)
        finish(event)
      }}
      onPointerCancel={finish}
    />
  )
}
