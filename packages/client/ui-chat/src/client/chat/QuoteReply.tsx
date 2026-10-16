/**
 * Transcript quote reply: a text selection inside the Chat frame raises a
 * floating Reply action; the mini composer that follows hands the excerpt plus
 * the typed answer to the composer draft. It never submits, so several replies
 * accumulate behind one later Enter.
 */
import {
  useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent,
} from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './QuoteReply.module.css'

/** Excerpt preview hard cap (head + ellipsis + tail); the composer card collapses it anyway. */
const EXCERPT_MAX = 1600
const EXCERPT_HEAD = 1200
const EXCERPT_TAIL = 400

/** Keep the floating excerpt bounded for pathological transcript selections. */
function clampExcerpt(quote: string): string {
  if (quote.length <= EXCERPT_MAX) return quote
  return `${quote.slice(0, EXCERPT_HEAD)}\n\n[…]\n\n${quote.slice(-EXCERPT_TAIL)}`
}

/** Where a floating control sits, in Chat-frame pixels. */
interface Anchor {
  readonly top: number
  readonly left: number
}

/** Inset keeping the centered control fully inside a narrow frame. */
const MIN_INSET = 56

/** Props of the transcript quote-reply host. */
export interface QuoteReplyProps {
  readonly t: ChatViewSlotProps['t']
  /** Append one excerpt + answer to the composer draft; never submits. */
  readonly onQuote: (quote: string, answer: string) => void
}

/**
 * Renders the selection-anchored Reply action and its mini composer. The host
 * frame is the layer's own parent, so the Chat view only has to mount this
 * component inside its `position: relative` frame.
 * @param props - locale thunk and the draft-append sink.
 */
export function QuoteReply({ t, onQuote }: QuoteReplyProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const rangeRef = useRef<Range | null>(null)
  const openRef = useRef(false)
  const [quote, setQuote] = useState('')
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState('')

  const frame = useCallback((): HTMLElement | null => layerRef.current?.parentElement ?? null, [])

  const measure = useCallback((range: Range): Anchor | null => {
    const host = frame()
    if (host === null) return null
    const rects = Array.from(range.getClientRects())
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
    const box = host.getBoundingClientRect()
    // A selection scrolled out of the frame keeps its text but loses its anchor.
    if (rect.bottom < box.top || rect.top > box.bottom) return null
    const limit = Math.max(host.clientWidth - MIN_INSET, MIN_INSET)
    const left = Math.min(Math.max(rect.left - box.left + rect.width / 2, MIN_INSET), limit)
    return { top: rect.bottom - box.top + 8, left }
  }, [frame])

  const reset = useCallback(() => {
    openRef.current = false
    rangeRef.current = null
    setOpen(false)
    setAnchor(null)
    setQuote('')
    setAnswer('')
  }, [])

  /** Raise the action for the current transcript selection; a no-op while composing. */
  const capture = useCallback(() => {
    if (openRef.current) return
    const layer = layerRef.current
    const host = frame()
    if (layer === null || host === null) return
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    const node = range.commonAncestorContainer
    if (!host.contains(node) || layer.contains(node)) return
    const text = clampExcerpt(selection.toString()).trim()
    if (text === '') return
    const next = measure(range)
    if (next === null) {
      setAnchor(null)
      return
    }
    rangeRef.current = range.cloneRange()
    setQuote(text)
    setAnchor(next)
  }, [frame, measure])

  useEffect(() => {
    const onSelectionChange = (): void => { capture() }
    // Any press outside the layer abandons the pending reply.
    const onPointerDown = (event: PointerEvent): void => {
      const layer = layerRef.current
      if (layer !== null && event.target instanceof Node && layer.contains(event.target)) return
      reset()
    }
    // Scrolling keeps the action glued to its excerpt; a range leaving the
    // frame drops the anchor but not the captured text.
    const onScroll = (): void => {
      if (openRef.current) return
      const range = rangeRef.current
      if (range === null) return
      const next = measure(range)
      if (next === null) {
        setAnchor(null)
        return
      }
      setAnchor(next)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [capture, measure, reset])

  useEffect(() => {
    if (open) boxRef.current?.focus()
  }, [open])

  const startReply = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // The press must not collapse the selection it was raised from.
    event.preventDefault()
    openRef.current = true
    setOpen(true)
  }, [])

  const confirm = useCallback(() => {
    const value = answer.trim()
    if (quote === '' || value === '') return
    onQuote(quote, value)
    reset()
  }, [answer, onQuote, quote, reset])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      confirm()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      reset()
    }
  }, [confirm, reset])

  return (
    <div className={css.layer} ref={layerRef} data-quote-reply="">
      {anchor === null ? null : open ? (
        <div className={css.box} data-quote-reply-box style={{ top: anchor.top, left: anchor.left }}>
          <div className={css.quote} data-quote-reply-excerpt>{quote}</div>
          <textarea
            ref={boxRef}
            className={css.answer}
            aria-label={t('quoteReply.placeholder')}
            placeholder={t('quoteReply.placeholder')}
            rows={3}
            value={answer}
            onChange={(event) => { setAnswer(event.target.value) }}
            onKeyDown={onKeyDown}
          />
          <div className={css.footer}>
            <span className={css.hint}>{t('quoteReply.hint')}</span>
            <button
              type="button"
              className={css.confirm}
              disabled={answer.trim() === ''}
              onClick={confirm}
            >
              {t('quoteReply.confirm')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={css.action}
          data-quote-reply-action
          style={{ top: anchor.top, left: anchor.left }}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={startReply}
        >
          {t('quoteReply.action')}
        </button>
      )}
    </div>
  )
}
