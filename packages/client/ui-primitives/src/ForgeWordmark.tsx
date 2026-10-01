import type { IconProps } from './icons/props.ts'

/**
 * Native box of the FORGE wordmark. `advance` is the text's fixed length along
 * x, so the box reserves the same space whatever the brand font resolves to.
 */
export const FORGE_WORDMARK_VIEWBOX = { advance: 72, height: 24 }

/**
 * Render the FORGE wordmark as text in the brand font, sized to the wordmark
 * box. The glyph baseline centers the capitals in the box's height.
 * @param props - icon props; `size` is the rendered box height in px.
 * @returns the wordmark svg, hidden from the accessibility tree.
 */
export function ForgeWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * FORGE_WORDMARK_VIEWBOX.advance) / FORGE_WORDMARK_VIEWBOX.height}
      height={size}
      className={className}
      viewBox={`0 0 ${FORGE_WORDMARK_VIEWBOX.advance} ${FORGE_WORDMARK_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <text
        x="0"
        y="18.7"
        textLength={FORGE_WORDMARK_VIEWBOX.advance}
        lengthAdjust="spacing"
        fill="currentColor"
        fontFamily="var(--dsw-font-family-brand)"
        fontSize="19"
        fontWeight="600"
      >
        FORGE
      </text>
    </svg>
  )
}
