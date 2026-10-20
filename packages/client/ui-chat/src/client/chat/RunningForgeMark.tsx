/** Anvil-and-hammer mark Chat shows while the Session runs: the whole logo is the hammer. */
import css from './RunningForgeMark.module.css'

/**
 * Render the FORGE work mark: every strike starts from the upright brand logo
 * raised behind the anvil and swings it down in an arc, its pointed tip landing
 * like a hammer head, with thin sparks fanning out from the struck face, drawn
 * over the logo so the head never hides them. The markup holds the impact pose;
 * the stylesheet owns the swing, so reduced motion can keep the upright logo
 * without React re-rendering.
 * @returns the animated svg, hidden from the accessibility tree.
 */
export function RunningForgeMark() {
  return (
    <span className={css.icon} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 32 32" fill="none">
        <g className={css.anvil} data-forge-anvil fill="currentColor">
          <path d="M3 19.7C5 19.3 7 19.2 9 19.2H22.4Q23 19.2 23 19.8V21.4L20.2 22.6C18.4 23.2 17.6 24.2 17.8 25.6C18 26.8 19.6 27.4 21.4 27.6Q22 27.7 22 28.3V29.4H16.4Q14.5 28.3 12.6 29.4H8.4V28.3Q8.4 27.7 9 27.6C10.8 27.4 12.4 26.8 12.6 25.6C12.8 24.2 12 23.2 10.4 22.6C7.4 22 4.6 20.6 3 19.9Z" />
        </g>
        <g className={css.hammer} data-forge-hammer>
          <g className={css.head}>
            <g transform="translate(12.13 12.97) rotate(84) scale(0.062) translate(-123 -130)">
              <path d="M24 241.5V68.5H147.5V88.5H44V241.5Z" fill="currentColor" />
              <path d="M62.5 241.5V107H147.5V127H82.5V241.5Z" fill="currentColor" />
              <polyline points="126.55,38 186.3,97.75 150.41,133.64" fill="none" stroke="currentColor"
                strokeWidth={13.5} strokeLinejoin="miter" />
              <polyline points="144.93,19.61 223.07,97.75 168.8,152.02" fill="none" stroke="currentColor"
                strokeWidth={13.5} strokeLinejoin="miter" />
            </g>
          </g>
        </g>
        <g className={css.sparks} data-forge-sparks strokeWidth="0.85" strokeLinecap="round">
          <line x1="13.22" y1="18.82" x2="8.69" y2="18.02" stroke="currentColor" />
          <line x1="13.44" y1="18.25" x2="8.86" y2="15.39" stroke="currentColor" />
          <line x1="13.95" y1="17.74" x2="11.62" y2="14.01" stroke="currentColor" />
          <line x1="16.38" y1="18.82" x2="20.91" y2="18.02" stroke="currentColor" />
          <line x1="16.16" y1="18.25" x2="20.74" y2="15.39" stroke="currentColor" />
          <line x1="15.65" y1="17.74" x2="17.98" y2="14.01" stroke="currentColor" />
          <circle cx="7.01" cy="15.95" r="0.55" fill="currentColor" stroke="none" />
          <circle cx="22.59" cy="15.95" r="0.55" fill="currentColor" stroke="none" />
        </g>
      </svg>
    </span>
  )
}
