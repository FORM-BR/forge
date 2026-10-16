/**
 * QuoteCardNode: one quoted transcript excerpt + reply as an atomic Lexical
 * block decorator. The card is a composer-only visual — `getTextContent()`
 * answers the blockquote + answer clipboard/persistence projection, so the
 * sent message and the draft mirror carry the full text while the editor
 * shows the collapsed card. The detect projection counts the card as one
 * U+FFFC (opaque-reference invariant); see projection.ts.
 */
import type { JSX } from 'react'
import type {
  EditorConfig, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode, Spread,
} from 'lexical'
import { $getNodeByKey, DecoratorNode } from 'lexical'
import { QuoteCard } from './QuoteCard.tsx'
import css from './QuoteCard.module.css'

/** JSON form of one card (Lexical node serialization contract). */
export type SerializedQuoteCardNode = Spread<{
  quote: string
  answer: string
}, SerializedLexicalNode>

/** Document-level dismissal signal: the face dispatches it, the editor removes the node. */
export const QUOTE_CARD_DISMISS_EVENT = 'dsh-quote-card-dismiss'

/**
 * The card's clipboard/persistence projection: the excerpt quoted line by
 * line (blank lines become `>`) plus the reply after a blank line. No
 * trailing newline — the composer walk supplies block seams.
 * @param quote - the transcript excerpt (CRLF tolerated).
 * @param answer - the reply text; empty answers a quote-only projection.
 * @returns the blockquote + answer text.
 */
export function quoteCardClipboard(quote: string, answer: string): string {
  const quoted = quote
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => line.trim() === '' ? '>' : `> ${line.trimEnd()}`)
    .join('\n')
  const cleanAnswer = answer.trim()
  return cleanAnswer === '' ? quoted : `${quoted}\n\n${cleanAnswer}`
}

/** One block-level quote card as an atomic decorator node. */
export class QuoteCardNode extends DecoratorNode<JSX.Element> {
  /** Cached transcript excerpt (display + projection source). */
  __quote: string
  /** Cached reply text; empty renders a quote-only card. */
  __answer: string

  /** Lexical node registry type tag. */
  static override getType(): string {
    return 'quote-card'
  }

  /**
   * Clone with identity (Lexical writable-copy contract).
   * @param node - node to clone.
   * @returns a copy carrying the same NodeKey.
   */
  static override clone(node: QuoteCardNode): QuoteCardNode {
    return new QuoteCardNode(node.__quote, node.__answer, node.__key)
  }

  /**
   * Rebuild one card from its JSON form.
   * @param json - serialized card.
   * @returns a fresh node (new key).
   */
  static override importJSON(json: SerializedQuoteCardNode): QuoteCardNode {
    return new QuoteCardNode(json.quote, json.answer)
  }

  /**
   * @param quote - the transcript excerpt.
   * @param answer - the reply text.
   * @param key - Lexical clone-path key; absent for fresh nodes.
   */
  constructor(quote: string, answer: string, key?: NodeKey) {
    super(key)
    this.__quote = quote
    this.__answer = answer
  }

  /** Serialize to the JSON node form. */
  override exportJSON(): SerializedQuoteCardNode {
    return {
      ...super.exportJSON(),
      type: 'quote-card',
      version: 1,
      quote: this.__quote,
      answer: this.__answer,
    }
  }

  /**
   * Mount the card's host element — a block, non-editable div carrying the
   * test/e2e anchor; the decorator portal renders the face into it.
   * @returns the block host element.
   */
  override createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-composer-quote-card', '')
    el.setAttribute('contenteditable', 'false')
    el.className = css.card ?? ''
    return el
  }

  /** Host element never changes shape. */
  override updateDOM(): boolean {
    return false
  }

  /** Cards occupy their own block line. */
  override isInline(): boolean {
    return false
  }

  /**
   * No keyboard-selected intermediate state: arrows and Backspace treat the
   * card as one atomic block (same rationale as the inline chips).
   */
  override isKeyboardSelectable(): boolean {
    return false
  }

  /** Clipboard / persistence projection (native copy reads this). */
  override getTextContent(): string {
    return quoteCardClipboard(this.__quote, this.__answer)
  }

  /** Cached transcript excerpt. */
  getQuote(): string {
    return this.getLatest().__quote
  }

  /** Cached reply text. */
  getAnswer(): string {
    return this.getLatest().__answer
  }

  /** React face rendered into the host element by the decorator portal. */
  override decorate(): JSX.Element {
    return (
      <QuoteCard
        quote={this.__quote}
        answer={this.__answer}
        dismissKey={this.getKey()}
        dismissEvent={QUOTE_CARD_DISMISS_EVENT}
      />
    )
  }
}

/**
 * Mint one quote card node.
 * @param quote - the transcript excerpt.
 * @param answer - the reply text.
 * @returns the fresh node.
 */
export function $createQuoteCardNode(quote: string, answer: string): QuoteCardNode {
  return new QuoteCardNode(quote, answer)
}

/**
 * Quote card type guard.
 * @param node - any node or nullish.
 * @returns whether the node is a QuoteCardNode.
 */
export function $isQuoteCardNode(node: LexicalNode | null | undefined): node is QuoteCardNode {
  return node instanceof QuoteCardNode
}

/**
 * Remove one card from outside the React face: the face dispatches this
 * editor's dismissal event on document; the listener (registered once per
 * editor) removes the node by key inside an editor update.
 * @param editor - the composer editor owning the card.
 * @returns the listener unregister.
 */
export function registerQuoteCardDismiss(editor: LexicalEditor): () => void {
  // Document-less hosts (shell harnesses, SSR) have no dismissal surface; the
  // editor still projects the card, only the face's X removal is inert there.
  if (typeof document === 'undefined') return () => {}
  const onDismiss = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const detail: unknown = event.detail
    if (typeof detail !== 'string' || detail === '') return
    editor.update(() => {
      const node = $getNodeByKey(detail)
      if ($isQuoteCardNode(node)) node.remove()
    })
  }
  document.addEventListener(QUOTE_CARD_DISMISS_EVENT, onDismiss)
  return () => { document.removeEventListener(QUOTE_CARD_DISMISS_EVENT, onDismiss) }
}
