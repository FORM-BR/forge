// @vitest-environment jsdom
/**
 * QuoteCardNode: block card semantics, clipboard projection, the composer
 * layout walk seams (card-adjacent blank lines), and the shell insertion/
 * dismissal path. Headless editors drive every case — the card's visual
 * face has its own component spec.
 */
import { Context } from '@deepseek-ai/cordis'
import { createHeadlessEditor } from '@lexical/headless'
import type { LexicalEditor, NodeKey } from 'lexical'
import { $createParagraphNode, $createTextNode, $getRoot, UNDO_COMMAND } from 'lexical'
import { describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { ReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import {
  QUOTE_CARD_DISMISS_EVENT, QuoteCardNode, $createQuoteCardNode, $isQuoteCardNode,
  quoteCardClipboard, registerQuoteCardDismiss,
} from '../src/client/input/editor/quote-card-node.tsx'
import {
  $composerLayout, $projectComposer, ATOMIC_CHAR, detectOffsetOfClipboardOffset,
} from '../src/client/input/editor/projection.ts'
import { TextRefNode } from '../src/client/input/editor/text-ref.ts'

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'quote-card-spec',
    nodes: [ReferenceChipNode, TextRefNode, QuoteCardNode],
    onError: (error) => { throw error },
  })
}

/** Ids per NodeKey the way the shell will assign them (stable, monotonic). */
function idAssigner(): (key: NodeKey) => number {
  const ids = new Map<NodeKey, number>()
  let seq = 0
  return (key) => {
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    seq += 1
    ids.set(key, seq)
    return seq
  }
}

function shell(): SessionInputShell {
  return new SessionInputShell({ actx: new Context(), defaultSink: vi.fn(), commandAttachments: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
  } })
}

describe('quoteCardClipboard', () => {
  it('quotes every line and appends the reply after a blank line', () => {
    expect(quoteCardClipboard('linha1\nlinha2', 'resposta')).toBe('> linha1\n> linha2\n\nresposta')
  })

  it('tolerates CRLF and trims trailing per-line whitespace', () => {
    expect(quoteCardClipboard('a\r\nb', '')).toBe('> a\n> b')
    expect(quoteCardClipboard('a\rb', '')).toBe('> a\n> b')
    expect(quoteCardClipboard('a  \nb ', '')).toBe('> a\n> b')
  })

  it('marks blank lines with a bare quote marker', () => {
    expect(quoteCardClipboard('a\n\nb', '')).toBe('> a\n>\n> b')
  })

  it('trims the answer and answers quote-only for an empty one', () => {
    expect(quoteCardClipboard('a', '  r  ')).toBe('> a\n\nr')
    expect(quoteCardClipboard('a', '   ')).toBe('> a')
  })
})

describe('QuoteCardNode', () => {
  it('carries quote/answer and answers the blockquote clipboard text', () => {
    const editor = makeEditor()
    editor.update(() => {
      const card = $createQuoteCardNode('trecho\nx', 'resposta')
      expect(card.getQuote()).toBe('trecho\nx')
      expect(card.getAnswer()).toBe('resposta')
      expect(card.getTextContent()).toBe('> trecho\n> x\n\nresposta')
      expect(card.isInline()).toBe(false)
      expect(card.isKeyboardSelectable()).toBe(false)
      expect($isQuoteCardNode(card)).toBe(true)
      expect($isQuoteCardNode($createTextNode('x'))).toBe(false)
    }, { discrete: true })
  })

  it('round-trips JSON with quote and answer', () => {
    const editor = makeEditor()
    editor.update(() => {
      const json = $createQuoteCardNode('trecho', 'resposta').exportJSON()
      expect(json.type).toBe('quote-card')
      const back = QuoteCardNode.importJSON(json)
      expect(back.getQuote()).toBe('trecho')
      expect(back.getAnswer()).toBe('resposta')
      expect(back.getTextContent()).toBe('> trecho\n\nresposta')
    }, { discrete: true })
  })

  it('mints a non-editable block host element', () => {
    const editor = makeEditor()
    editor.update(() => {
      const card = $createQuoteCardNode('trecho', '')
      const el = card.createDOM({} as never) as HTMLDivElement
      expect(el.tagName).toBe('DIV')
      expect(el.dataset.composerQuoteCard).toBe('')
      expect(el.getAttribute('contenteditable')).toBe('false')
      expect(el.className).not.toBe('')
      expect(card.updateDOM()).toBe(false)
    }, { discrete: true })
  })

  it('dismiss registration removes only the addressed card', async () => {
    const editor = makeEditor()
    let cardKey = '' as NodeKey
    const off = registerQuoteCardDismiss(editor)
    try {
      editor.update(() => {
        const card = $createQuoteCardNode('trecho', 'r')
        cardKey = card.getKey()
        $getRoot().append(card, $createParagraphNode().append($createTextNode('x')))
      }, { discrete: true })
      // Foreign detail (non-string) must not remove anything.
      document.dispatchEvent(new CustomEvent(QUOTE_CARD_DISMISS_EVENT, { detail: 42 }))
      expect(editor.getEditorState().read(() => $getRoot().getChildrenSize())).toBe(2)
      document.dispatchEvent(new CustomEvent(QUOTE_CARD_DISMISS_EVENT, { detail: cardKey }))
      await vi.waitFor(() => {
        editor.getEditorState().read(() => {
          expect($getRoot().getChildrenSize()).toBe(1)
          expect($isQuoteCardNode($getRoot().getFirstChild())).toBe(false)
        })
      })
    } finally { off() }
  })
})

describe('composer layout with cards', () => {
  it('projects one card as a single atomic detect char with the blockquote clipboard', () => {
    const editor = makeEditor()
    editor.update(() => {
      $getRoot().append($createQuoteCardNode('trecho\nx', 'resposta'))
    }, { discrete: true })
    const layout = editor.getEditorState().read(() => $composerLayout())
    expect(layout.detectText).toBe(ATOMIC_CHAR)
    expect(layout.clipboardText).toBe('> trecho\n> x\n\nresposta')
  })

  it('widens only card-adjacent seams in the clipboard projection', () => {
    const editor = makeEditor()
    editor.update(() => {
      $getRoot().append(
        $createQuoteCardNode('a', 'r1'),
        $createParagraphNode().append($createTextNode('hola')),
        $createParagraphNode().append($createTextNode('mundo')),
        $createQuoteCardNode('b', 'r2'),
      )
    }, { discrete: true })
    const layout = editor.getEditorState().read(() => $composerLayout())
    // Detect seams stay single newlines; clipboard seams around cards are blank lines.
    expect(layout.detectText).toBe(`${ATOMIC_CHAR}\nhola\nmundo\n${ATOMIC_CHAR}`)
    expect(layout.clipboardText).toBe('> a\n\nr1\n\nhola\nmundo\n\n> b\n\nr2')
    const gaps = layout.segments.filter(segment => segment.kind === 'gap')
    expect(gaps.map(gap => gap.clipboardLength)).toEqual([2, 1, 2])
  })

  it('folds clipboard boundaries inside a card to its trailing edge', () => {
    const editor = makeEditor()
    editor.update(() => {
      $getRoot().append($createQuoteCardNode('trecho', 'resposta'))
    }, { discrete: true })
    const layout = editor.getEditorState().read(() => $composerLayout())
    expect(detectOffsetOfClipboardOffset(layout, 10)).toBe(1)
    expect(detectOffsetOfClipboardOffset(layout, layout.clipboardText.length)).toBe(1)
  })

  it('ignores cards as occurrences while keeping the draft text', () => {
    const editor = makeEditor()
    editor.update(() => {
      $getRoot().append(
        $createQuoteCardNode('trecho', 'r'),
        $createParagraphNode().append($createTextNode('hola')),
      )
    }, { discrete: true })
    const projection = editor.getEditorState().read(() => $projectComposer(idAssigner()))
    expect(projection.detectText).toBe(`${ATOMIC_CHAR}\nhola`)
    expect(projection.clipboardText).toBe('> trecho\n\nr\n\nhola')
    expect(projection.occurrences).toEqual([])
  })
})

describe('insertQuoteCard via the session shell', () => {
  it('stacks a card above the draft text without submitting', () => {
    const input = shell()
    try {
      input.setDraft('hola')
      expect(input.actions.insertQuoteCard('trecho\nx', '  resposta  ')).toBe(true)
      const snapshot = input.state.getSnapshot()
      expect(snapshot.draft).toBe('> trecho\n> x\n\nresposta\n\nhola')
      expect(snapshot.phase).toBe('plain')
    } finally { input.dispose() }
  })

  it('keeps cards grouped above the text in insertion order', () => {
    const input = shell()
    try {
      input.setDraft('texto')
      input.actions.insertQuoteCard('primeiro', 'r1')
      input.actions.insertQuoteCard('segundo', 'r2')
      expect(input.state.getSnapshot().draft).toBe('> primeiro\n\nr1\n\n> segundo\n\nr2\n\ntexto')
    } finally { input.dispose() }
  })

  it('renders a quote-only card for an empty answer', () => {
    const input = shell()
    try {
      input.setDraft('x')
      input.actions.insertQuoteCard('trecho', '   ')
      expect(input.state.getSnapshot().draft).toBe('> trecho\n\nx')
    } finally { input.dispose() }
  })

  it('sanitizes reference placeholders from quote and answer', () => {
    const input = shell()
    try {
      input.setDraft('x')
      input.actions.insertQuoteCard('a\uFFFCb', 'r\uE100')
      expect(input.state.getSnapshot().draft).toBe('> ab\n\nr\n\nx')
    } finally { input.dispose() }
  })

  it('owns one undo step per card', async () => {
    const input = shell()
    try {
      input.setDraft('antes')
      const original = input.state.getSnapshot().draft
      input.actions.insertQuoteCard('trecho', 'r')
      expect(input.state.getSnapshot().draft).not.toBe(original)
      input.editor.dispatchCommand(UNDO_COMMAND, undefined)
      await vi.waitFor(() => { expect(input.state.getSnapshot().draft).toBe(original) })
    } finally { input.dispose() }
  })

  it('dismisses a card through the document event', async () => {
    const input = shell()
    try {
      input.setDraft('texto')
      input.actions.insertQuoteCard('trecho', 'r')
      let cardKey = '' as NodeKey
      input.editor.update(() => {
        const card = $getRoot().getChildren().find(child => $isQuoteCardNode(child))
        cardKey = card!.getKey()
      })
      document.dispatchEvent(new CustomEvent(QUOTE_CARD_DISMISS_EVENT, { detail: cardKey }))
      await vi.waitFor(() => { expect(input.state.getSnapshot().draft).toBe('texto') })
    } finally { input.dispose() }
  })

  it('refuses after disposal', () => {
    const input = shell()
    input.dispose()
    expect(input.actions.insertQuoteCard('trecho', 'r')).toBe(false)
  })
})
