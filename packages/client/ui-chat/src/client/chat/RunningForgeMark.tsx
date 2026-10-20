/** Anvil-and-hammer mark Chat shows while the Session runs: the FORGE logo is the hammer head. */
import css from './RunningForgeMark.module.css'

/**
 * Render the FORGE work mark: an anvil on its pedestal, a hammer whose head is
 * the FORGE logo, and an amber spark burst on impact. The stylesheet owns every
 * pose so reduced motion can hold the hammer raised without React re-rendering.
 * @returns the animated svg, hidden from the accessibility tree.
 */
export function RunningForgeMark() {
  return (
    <span className={css.icon} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
        <g className={css.sparks} data-forge-sparks>
          <line x1="12.1" y1="19" x2="8.4" y2="15.4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1="12.1" y1="19" x2="10" y2="14" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1="12.1" y1="19" x2="12.4" y2="13.4" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1="12.1" y1="19" x2="14.8" y2="14.2" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1="12.1" y1="19" x2="16.6" y2="15.6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <line x1="12.1" y1="19" x2="9.2" y2="17.6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <circle cx="8.6" cy="13.6" r="1" fill="currentColor" />
          <circle cx="14.2" cy="13.2" r="0.8" fill="currentColor" />
          <circle cx="16.9" cy="14.6" r="1" fill="currentColor" />
        </g>
        <g className={css.anvil} data-forge-anvil fill="currentColor">
          <path d="M2 21.2 8.4 19.4V22.6Z" />
          <rect x="8" y="19.2" width="14" height="3.4" rx="0.4" />
          <path d="M11.5 22.6h5l-.7 2.8h-3.6Z" />
          <path d="M12.2 25.4h3.6l2.8 4H9.4Z" />
        </g>
        <g className={css.hammer} data-forge-hammer>
          <line x1="27.5" y1="3.5" x2="14.5" y2="9.5" stroke="currentColor" strokeWidth={2.2}
            strokeLinecap="round" />
          <g transform="translate(5.5 4.5) scale(0.0390625)">
            <path d="M24 241.5V68.5H147.5V88.5H44V241.5Z" fill="currentColor" />
            <path d="M62.5 241.5V107H147.5V127H82.5V241.5Z" fill="currentColor" />
            <polyline points="126.55,38 186.3,97.75 150.41,133.64" fill="none" stroke="currentColor"
              strokeWidth={13.5} strokeLinejoin="miter" />
            <polyline points="144.93,19.61 223.07,97.75 168.8,152.02" fill="none" stroke="currentColor"
              strokeWidth={13.5} strokeLinejoin="miter" />
          </g>
        </g>
      </svg>
    </span>
  )
}
