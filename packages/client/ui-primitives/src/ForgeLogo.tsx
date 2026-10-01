import type { IconProps } from './icons/props.ts'

/**
 * Native box of the FORGE mark: a square with the ink centered inside it. The
 * two nested corner bars end where their outer corners touch the inner of two
 * butt-capped, miter-joined chevrons, so bars and chevrons read as one arrow.
 */
export const FORGE_LOGO_VIEWBOX = { x: 0, y: 0, width: 256, height: 256 }

/**
 * Render the FORGE mark (two nested corner bars followed by a double chevron)
 * in `currentColor` inside its square box.
 * @param props - icon props; `size` is the rendered width and height in px.
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
      <path d="M24 241.5V68.5H147.5V88.5H44V241.5Z" fill="currentColor" />
      <path d="M62.5 241.5V107H147.5V127H82.5V241.5Z" fill="currentColor" />
      <polyline
        points="126.55,38 186.3,97.75 150.41,133.64"
        fill="none"
        stroke="currentColor"
        strokeWidth="13.5"
        strokeLinejoin="miter"
      />
      <polyline
        points="144.93,19.61 223.07,97.75 168.8,152.02"
        fill="none"
        stroke="currentColor"
        strokeWidth="13.5"
        strokeLinejoin="miter"
      />
    </svg>
  )
}
