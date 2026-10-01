import type { IconProps } from './icons/props.ts'

/**
 * Native box of the FORGE mark: the painted extents of the three bars and the
 * two chevrons, square-capped and miter-joined, so the authored padding is
 * symmetric around the ink on every side.
 */
export const FORGE_LOGO_VIEWBOX = { x: 86, y: 76, width: 353, height: 288 }

/**
 * Render the FORGE mark (barred F followed by a double chevron) in
 * `currentColor` at the mark's native ratio.
 * @param props - icon props; `size` is the rendered width in px.
 * @returns the mark svg, hidden from the accessibility tree.
 */
export function ForgeLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * FORGE_LOGO_VIEWBOX.height) / FORGE_LOGO_VIEWBOX.width}
      className={className}
      viewBox={`${FORGE_LOGO_VIEWBOX.x} ${FORGE_LOGO_VIEWBOX.y} ${FORGE_LOGO_VIEWBOX.width} ${FORGE_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <rect x="100" y="90" width="36" height="260" fill="currentColor" />
      <rect x="100" y="90" width="150" height="36" fill="currentColor" />
      <rect x="180" y="170" width="36" height="180" fill="currentColor" />
      <polyline
        points="270,140 330,220 270,300"
        fill="none"
        stroke="currentColor"
        strokeWidth="36"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <polyline
        points="330,140 400,220 330,300"
        fill="none"
        stroke="currentColor"
        strokeWidth="36"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  )
}
