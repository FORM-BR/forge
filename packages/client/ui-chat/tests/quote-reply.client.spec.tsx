// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QuoteReplyProps } from '../src/client/chat/QuoteReply.tsx'
import { QuoteReply } from '../src/client/chat/QuoteReply.tsx'
import { projectUserBubbleText, splitQuoteBlocks } from '../src/client/chat/MessageItem.tsx'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)

const EXCERPT = 'texto para selecionar'

const frameBox = {
  top: 0, left: 0, right: 400, bottom: 600,
  x: 0, y: 0, width: 400, height: 600,
  toJSON: () => ({}),
} as DOMRect

const rangeBox = {
  top: 100, left: 50, right: 300, bottom: 120,
  x: 50, y: 100, width: 250, height: 20,
  toJSON: () => ({}),
} as DOMRect

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(frameBox)
  // jsdom does not implement Range.getClientRects; supply the geometry the
  // anchor measurement needs.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => [rangeBox],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects
})

function harness(onQuote: QuoteReplyProps['onQuote'] = vi.fn()) {
  const view = render(
    <div data-frame>
      <p>linha acima</p>
      <p data-excerpt>{EXCERPT}</p>
      <p>linha abaixo</p>
      <QuoteReply t={t} onQuote={onQuote} />
    </div>,
  )
  return {
    ...view,
    onQuote,
    selectExcerpt: () => {
      const node = view.container.querySelector('[data-excerpt]')!
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      act(() => { document.dispatchEvent(new Event('selectionchange')) })
    },
    action: () => view.container.querySelector('[data-quote-reply-action]'),
    box: () => view.container.querySelector('[data-quote-reply-box]'),
    excerpt: () => view.container.querySelector('[data-quote-reply-excerpt]'),
    answer: () => view.container.querySelector<HTMLTextAreaElement>('[data-quote-reply] textarea'),
  }
}

describe('QuoteReply', () => {
  it('raises the reply action for a transcript selection', () => {
    const view = harness()
    expect(view.action()).toBeNull()
    view.selectExcerpt()
    const action = view.action()
    expect(action).not.toBeNull()
    expect(action!.textContent).toBe('回复')
  })

  it('stays quiet for a collapsed selection', () => {
    const view = harness()
    const node = view.container.querySelector('[data-excerpt]')!
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    expect(view.action()).toBeNull()
  })

  it('hands the excerpt and answer to onQuote on Enter, then closes', () => {
    const view = harness()
    view.selectExcerpt()
    const action = view.action()!
    fireEvent.mouseDown(action)
    fireEvent.click(action)
    const answer = view.answer()!
    expect(answer).not.toBeNull()
    fireEvent.change(answer, { target: { value: '  minha resposta  ' } })
    fireEvent.keyDown(answer, { key: 'Enter' })
    expect(view.onQuote).toHaveBeenCalledWith(EXCERPT, 'minha resposta')
    expect(view.box()).toBeNull()
    expect(view.answer()).toBeNull()
  })

  it('refuses an empty answer', () => {
    const view = harness()
    view.selectExcerpt()
    fireEvent.mouseDown(view.action()!)
    fireEvent.click(view.action()!)
    const answer = view.answer()!
    fireEvent.keyDown(answer, { key: 'Enter' })
    expect(view.onQuote).not.toHaveBeenCalled()
    expect(view.box()).not.toBeNull()
  })

  it('discards the pending reply on Escape without calling onQuote', () => {
    const view = harness()
    view.selectExcerpt()
    fireEvent.mouseDown(view.action()!)
    fireEvent.click(view.action()!)
    fireEvent.change(view.answer()!, { target: { value: 'descartar' } })
    fireEvent.keyDown(view.answer()!, { key: 'Escape' })
    expect(view.onQuote).not.toHaveBeenCalled()
    expect(view.box()).toBeNull()
  })

  it('closes when the user presses outside the layer', () => {
    const view = harness()
    view.selectExcerpt()
    fireEvent.mouseDown(view.action()!)
    fireEvent.click(view.action()!)
    expect(view.box()).not.toBeNull()
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    act(() => { outside.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(view.box()).toBeNull()
    outside.remove()
  })

  it('clamps a pathological long excerpt in the floating preview', () => {
    const long = 'A'.repeat(2000)
    const view = render(
      <div data-frame>
        <p data-excerpt>{long}</p>
        <QuoteReply t={t} onQuote={vi.fn()} />
      </div>,
    )
    const node = view.container.querySelector('[data-excerpt]')!
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    act(() => { document.dispatchEvent(new Event('selectionchange')) })
    const action = view.container.querySelector('[data-quote-reply-action]')!
    fireEvent.mouseDown(action)
    fireEvent.click(action)
    const preview = view.container.querySelector('[data-quote-reply-excerpt]')!.textContent
    expect(preview).toContain('[…]\n\n')
    expect(preview.length).toBeLessThan(long.length)
  })
})

describe('splitQuoteBlocks / projectUserBubbleText (mensagem enviada)', () => {
  it('retorna undefined cuando el texto no tiene lineas de cita', () => {
    expect(splitQuoteBlocks('Hola, todo bien?')).toBeUndefined()
    expect(splitQuoteBlocks('')).toBeUndefined()
  })

  it('agrupa lineas `>` consecutivas como bloque de cita sin el prefijo', () => {
    expect(splitQuoteBlocks('> tengo un plan\n> en dos pasos')).toEqual([
      { kind: 'quote', text: 'tengo un plan\nen dos pasos' },
    ])
  })

  it('alterna cita y resto como manda el clipboard del card', () => {
    expect(splitQuoteBlocks('> pregunta\n\nmi respuesta\n\nsiguiente')).toEqual([
      { kind: 'quote', text: 'pregunta' },
      { kind: 'plain', text: '\nmi respuesta\n\nsiguiente' },
    ])
  })

  it('soporta varias citas consecutivas sin sangria extra', () => {
    const blocks = splitQuoteBlocks('# nada\n> una\n> dos\n# medio\n> tres')
    expect(blocks).toEqual([
      { kind: 'plain', text: '# nada' },
      { kind: 'quote', text: 'una\ndos' },
      { kind: 'plain', text: '# medio' },
      { kind: 'quote', text: 'tres' },
    ])
  })

  it('renderiza la cita como blockquote y el resto como texto llano', () => {
    const view = render(
      <div>{projectUserBubbleText('> pregunta\n\nmi respuesta', [], [], undefined)}</div>,
    )
    const quote = view.container.querySelector('[data-quote-block]')
    expect(quote).not.toBeNull()
    expect(quote!.textContent).toBe('pregunta')
    expect(view.container.textContent).toBe('pregunta\nmi respuesta')
  })

  it('mantiene la proyeccion anterior cuando no hay cita', () => {
    expect(projectUserBubbleText('Hola, tambien @archivo', [], [], undefined)).toBeNull()
  })
})
