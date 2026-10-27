// @vitest-environment jsdom
/**
 * QuoteCard visual face: excerpt and reply rendering, the dismissal event
 * raised by the X button, and the localized accessible name supplied by the
 * portal loop through context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { QuoteCard, QuoteCardDismissLabel } from '../src/client/input/editor/QuoteCard.tsx'

afterEach(cleanup)

describe('QuoteCard', () => {
  it('renders the excerpt with its full text as title, and the reply when present', () => {
    const { container } = render(
      <QuoteCard quote="trecho" answer="resposta" dismissKey="k1" dismissEvent="evt" />,
    )
    expect(container.querySelector('[data-composer-quote-card-excerpt]')?.getAttribute('title')).toBe('trecho')
    expect(container.querySelector('[data-composer-quote-card-answer]')?.textContent).toBe('resposta')
  })

  it('omits the reply block for a quote-only card', () => {
    const { container } = render(
      <QuoteCard quote="trecho" answer="" dismissKey="k1" dismissEvent="evt" />,
    )
    expect(container.querySelector('[data-composer-quote-card-answer]')).toBeNull()
  })

  it('names the dismiss button from the provided label and leaves it unnamed without one', () => {
    const labelled = render(
      <QuoteCardDismissLabel.Provider value="Remover citação">
        <QuoteCard quote="q" answer="" dismissKey="k1" dismissEvent="evt" />
      </QuoteCardDismissLabel.Provider>,
    )
    expect(labelled.container.querySelector('[data-composer-quote-card-dismiss]')?.getAttribute('aria-label'))
      .toBe('Remover citação')
    labelled.unmount()

    const bare = render(<QuoteCard quote="q" answer="" dismissKey="k1" dismissEvent="evt" />)
    expect(bare.container.querySelector('[data-composer-quote-card-dismiss]')?.hasAttribute('aria-label')).toBe(false)
  })

  it('raises the dismissal event with the node key and keeps the press away from the composer', () => {
    const received: unknown[] = []
    const listener = (event: Event): void => { received.push((event as CustomEvent).detail) }
    document.addEventListener('evt', listener)
    try {
      const { container } = render(
        <QuoteCard quote="q" answer="" dismissKey="k42" dismissEvent="evt" />,
      )
      const button = container.querySelector('[data-composer-quote-card-dismiss]')!
      const mouseDown = fireEvent.mouseDown(button)
      expect(mouseDown).toBe(false) // preventDefault keeps composer focus and selection
      fireEvent.click(button)
      expect(received).toEqual(['k42'])
    } finally {
      document.removeEventListener('evt', listener)
    }
  })

  it('stops the click from reaching ancestors', () => {
    const outer = vi.fn()
    const { container } = render(
      <div onClick={outer}>
        <QuoteCard quote="q" answer="" dismissKey="k" dismissEvent="evt" />
      </div>,
    )
    fireEvent.click(container.querySelector('[data-composer-quote-card-dismiss]')!)
    expect(outer).not.toHaveBeenCalled()
  })
})
