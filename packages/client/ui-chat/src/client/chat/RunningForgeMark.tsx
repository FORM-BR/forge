/** Anvil-and-hammer mark Chat shows while the Session runs: the FORGE logo is the hammer head. */
import css from './RunningForgeMark.module.css'

/** Impact point on the anvil face where the hammer lands and the sparks leave. */
const IMPACT = { x: 8.5, y: 15 }

/**
 * Render the FORGE work mark: an anvil, a hammer made of the FORGE logo, and
 * impact sparks. The stylesheet owns every pose so reduced motion can hold the
 * hammer raised without React re-rendering.
 * @returns the animated svg, hidden from the accessibility tree.
 */
export function RunningForgeMark() {
  return (
    <span className={css.icon} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none">
        <g className={css.sparks} data-forge-sparks>
          <line x1={IMPACT.x} y1={IMPACT.y} x2="6.6" y2="12.6" stroke="currentColor" strokeWidth={1}
            strokeLinecap="round" />
          <line x1={IMPACT.x} y1={IMPACT.y} x2="8.3" y2="12" stroke="currentColor" strokeWidth={1}
            strokeLinecap="round" />
          <line x1={IMPACT.x} y1={IMPACT.y} x2="10.5" y2="12.7" stroke="currentColor" strokeWidth={1}
            strokeLinecap="round" />
          <circle cx={IMPACT.x} cy={IMPACT.y} r={0.9} fill="currentColor" />
        </g>
        <path className={css.anvil} data-forge-anvil
          d="M2 15.2H15V16.3H12V18.4H14.6V20H6.4V18.4H8.4V16.3H2Z" fill="currentColor" />
        <g className={css.hammer} data-forge-hammer>
          <line x1="21" y1="3.2" x2="10.2" y2="10.4" stroke="currentColor" strokeWidth={1.3}
            strokeLinecap="round" />
          <g transform="translate(5.4 6.2) scale(0.03515625)">
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
