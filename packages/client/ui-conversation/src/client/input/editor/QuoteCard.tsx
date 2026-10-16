/**
 * Visual body of one composer quote card: the DecoratorNode's React face.
 * Pure display — identity, invalidation, and lifecycle live on the
 * QuoteCardNode; this component renders the node's cached excerpt and reply
 * and raises the editor's dismissal event for its X button.
 */
import type { MouseEvent, ReactNode } from 'react'
import css from './QuoteCard.module.css'

/** Display inputs of one quote card. */
export interface QuoteCardProps {
  readonly quote: string
  readonly answer: string
  /** NodeKey of the owned card; rides the dismissal event detail. */
  readonly dismissKey: string
  /** Event name the owning editor listens for (see registerQuoteCardDismiss). */
  readonly dismissEvent: string
}

/**
 * Render one composer quote card (collapsed excerpt + reply + dismiss).
 * The full excerpt stays in the node and in this element's title; the
 * visible block is a short line-clamped preview.
 * @param props - cached quote/answer and the dismissal routing.
 * @returns the card body.
 */
export function QuoteCard({ quote, answer, dismissKey, dismissEvent }: QuoteCardProps): ReactNode {
  const onDismiss = (event: MouseEvent<HTMLButtonElement>): void => {
    // Keep the press away from the composer (selection/caret side effects).
    event.preventDefault()
    event.stopPropagation()
    document.dispatchEvent(new CustomEvent(dismissEvent, { detail: dismissKey }))
  }
  return (
    <div className={css.body}>
      <div className={css.excerpt} data-composer-quote-card-excerpt title={quote}>{quote}</div>
      {answer !== '' && <div className={css.answer} data-composer-quote-card-answer>{answer}</div>}
      <button
        type="button"
        className={css.dismiss}
        aria-label="Remove quote"
        data-composer-quote-card-dismiss
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}
