/** Anvil-and-hammer mark Chat shows while the Session runs: the whole logo is the hammer. */
import css from './RunningForgeMark.module.css'

/**
 * Render the FORGE work mark: the logo itself swung onto an anvil, its pointed
 * tip leading like a hammer head and its upright stroke trailing as the handle,
 * with sparks thrown out to both sides above the impact. The stylesheet owns
 * every pose so reduced motion can hold the logo raised without React
 * re-rendering.
 * @returns the animated svg, hidden from the accessibility tree.
 */
export function RunningForgeMark() {
  return (
    <span className={css.icon} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
        <g className={css.sparks} data-forge-sparks strokeWidth="0.9" strokeLinecap="round">
          <line x1="13.2" y1="16.2" x2="10.4" y2="14.6" stroke="currentColor" />
          <line x1="12.9" y1="16.9" x2="9.8" y2="16.3" stroke="currentColor" />
          <line x1="13.3" y1="17.5" x2="10.6" y2="18.2" stroke="currentColor" />
          <line x1="14.6" y1="16.2" x2="17.4" y2="14.6" stroke="currentColor" />
          <line x1="14.9" y1="16.9" x2="18" y2="16.3" stroke="currentColor" />
          <line x1="14.5" y1="17.5" x2="17.2" y2="18.2" stroke="currentColor" />
          <circle cx="9.1" cy="15.2" r="0.5" fill="currentColor" stroke="none" />
          <circle cx="18.8" cy="15" r="0.5" fill="currentColor" stroke="none" />
        </g>
        <g className={css.anvil} data-forge-anvil fill="currentColor">
          <path d="M3 20.5Q6.4 19.1 9.6 19.1v2.5Q6.6 21.6 3 20.5Z" />
          <path d="M9.6 19.1h12.2q0.8 0 0.8 0.8v1q0 0.8-0.8 0.8H9.6Z" />
          <path d="M19.4 22.7h3.2v1.1h-3.2Z" />
          <path d="M12.3 22.7h5.4q-0.5 1.4-1.2 2.9h-3q-0.7-1.5-1.2-2.9Z" />
          <path d="M9.7 25.6h10.6l0.9 2.8H8.8Z" />
          <path d="M8.6 28.4h14.8q0.3 0 0.3 0.3v0.5q0 0.3-0.3 0.3H8.6q-0.3 0-0.3-0.3v-0.5q0-0.3 0.3-0.3Z" />
        </g>
        <g className={css.hammer} data-forge-hammer>
          <g transform="translate(9.83 10.27) rotate(70) scale(0.062) translate(-123 -130)">
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
