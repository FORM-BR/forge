/** Anvil-and-hammer mark Chat shows while the Session runs: the FORGE logo is the hammer. */
import css from './RunningForgeMark.module.css'

/**
 * Render the FORGE work mark: the logo itself swung onto an anvil, its pointed
 * tip leading like a hammer head and its upright stroke trailing as the handle,
 * with a few short sparks off the impact. The stylesheet owns every pose so
 * reduced motion can hold the logo raised without React re-rendering.
 * @returns the animated svg, hidden from the accessibility tree.
 */
export function RunningForgeMark() {
  return (
    <span className={css.icon} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
        <g className={css.sparks} data-forge-sparks strokeWidth="0.9" strokeLinecap="round">
          <line x1="14" y1="18.1" x2="12.4" y2="16.4" stroke="currentColor" />
          <line x1="14.6" y1="17.7" x2="14.1" y2="15.3" stroke="currentColor" />
          <line x1="15.2" y1="17.8" x2="16.5" y2="16.2" stroke="currentColor" />
          <line x1="15.6" y1="18.2" x2="17.7" y2="17.7" stroke="currentColor" />
          <circle cx="11.9" cy="15.4" r="0.5" fill="currentColor" stroke="none" />
          <circle cx="17.9" cy="15.1" r="0.45" fill="currentColor" stroke="none" />
        </g>
        <g className={css.anvil} data-forge-anvil fill="currentColor">
          <path d="M2 21.2 8.4 19.4V22.6Z" />
          <rect x="8" y="19.2" width="14" height="3.4" rx="0.4" />
          <path d="M11.5 22.6h5l-.7 2.8h-3.6Z" />
          <path d="M12.2 25.4h3.6l2.8 4H9.4Z" />
        </g>
        <g className={css.hammer} data-forge-hammer>
          <g transform="translate(17.43 12.67) rotate(135) scale(0.062) translate(-123 -130)">
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
