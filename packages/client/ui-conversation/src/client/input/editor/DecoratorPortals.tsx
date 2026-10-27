/**
 * Decorator render loop: portals every decorator node's React face into its
 * host element (what @lexical/react's composer does internally, scoped to
 * this composer's needs). Chip DOM identity rides the NodeKey — text edits
 * around a chip never remount its portal.
 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import type { LexicalEditor, NodeKey } from 'lexical'
import { QuoteCardDismissLabel } from './QuoteCard.tsx'

/** Portal-loop props. */
export interface DecoratorPortalsProps {
  /** The bound editor; null (no-session) renders nothing. */
  readonly editor: LexicalEditor | null
  /** Localized accessible name of the quote card's dismiss button. */
  readonly quoteDismissLabel: string
}

/**
 * Render every decorator's React face into its editor host element.
 * @param props - the editor to observe and the localized quote-card dismiss label.
 * @returns the live portal set.
 */
export function DecoratorPortals({ editor, quoteDismissLabel }: DecoratorPortalsProps): ReactNode {
  const [decorators, setDecorators] = React.useState<Record<NodeKey, React.JSX.Element>>(
    () => editor === null ? {} : editor.getDecorators<React.JSX.Element>(),
  )
  React.useLayoutEffect(() => {
    if (editor === null) return
    setDecorators(editor.getDecorators<React.JSX.Element>())
    return editor.registerDecoratorListener<React.JSX.Element>((next) => { setDecorators(next) })
  }, [editor])
  if (editor === null) return null
  return (
    <QuoteCardDismissLabel.Provider value={quoteDismissLabel}>
      {Object.entries(decorators).map(([key, jsx]) => {
        const el = editor.getElementByKey(key)
        return el === null ? null : createPortal(jsx, el, key)
      })}
    </QuoteCardDismissLabel.Provider>
  )
}
