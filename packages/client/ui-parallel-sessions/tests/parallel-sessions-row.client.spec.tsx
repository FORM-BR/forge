// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
// Type-only: pulls the locale namespace merge this package declares.
import type {} from '../src/client/index.ts'
import { ParallelSessionsRow, type ParallelSessionsInjected } from '../src/client/ParallelSessionsRow.tsx'
import { en } from '../src/client/locales.ts'

type RowProps = Parameters<typeof ParallelSessionsRow>[0]

const t: RowProps['t'] = makeTranslate(en, commonEn)
const TASKS = [
  { title: 'Waitlist copy', prompt: 'Rewrite the waitlist page copy to name the launch date.' },
  { title: 'Pricing table', prompt: 'Compare the three plans and list the missing rows.' },
]

afterEach(cleanup)

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 3,
    time: 3_000,
    callId: 'call-parallel',
    call: { name: 'suggest_parallel_sessions', argsRaw: JSON.stringify({ tasks: TASKS }) },
    callTime: 2_000,
    content: [{ type: 'text', text: 'Offered 2 parallel sessions: Waitlist copy; Pricing table.' }],
    isError: false,
    subCalls: [],
    ...over,
  }
}

/**
 * Compose the keyed toolview owner plus the row's locale seat and published offer.
 * @param block - the settled result or the preparing placeholder.
 * @param injected - the injected offer verbs, defaulting to fresh spies.
 * @returns the component props.
 */
function props(
  block: RowProps['block'],
  injected: Pick<ParallelSessionsInjected, 'publishOffer' | 'clearOffer'> = {
    publishOffer: vi.fn(),
    clearOffer: vi.fn(),
  },
): RowProps {
  return {
    callId: block.callId,
    toolName: 'suggest_parallel_sessions',
    ...('kind' in block ? { phase: 'result' as const, block } : { phase: block.phase, block }),
    useDisclosure: () => ({ expanded: false, setExpanded: vi.fn(), toggle: vi.fn() }),
    loadImage: vi.fn(),
    openFile: vi.fn(),
    t,
    ...injected,
  } as RowProps
}

describe('ParallelSessionsRow', () => {
  it('names the offer while the call is still preparing', () => {
    const view = render(<ParallelSessionsRow {...props({
      phase: 'preparing', callId: 'call-parallel', name: 'suggest_parallel_sessions', turn: 1, step: 1, time: 1, subCalls: [],
    })} />)
    expect(view.getAllByText('Suggesting parallel sessions').length).toBeGreaterThan(0)
    expect(view.queryByRole('button')).toBeNull()
  })

  it('publishes the offered tasks and points at the pinned card', () => {
    const publishOffer = vi.fn()
    const view = render(<ParallelSessionsRow {...props(settled(), { publishOffer, clearOffer: vi.fn() })} />)
    expect(view.getByText('Suggested 2 parallel sessions')).toBeTruthy()
    expect(view.getByText('In the header')).toBeTruthy()
    expect(publishOffer).toHaveBeenCalledWith({ callId: 'call-parallel', tasks: TASKS })
    // The trace keeps no task bodies and no start gesture: those belong to the pinned card.
    expect(view.queryByText('Waitlist copy')).toBeNull()
    expect(view.queryByRole('button')).toBeNull()
  })

  it('withdraws the offer when the row leaves the transcript', () => {
    const clearOffer = vi.fn()
    const view = render(<ParallelSessionsRow {...props(settled(), { publishOffer: vi.fn(), clearOffer })} />)
    view.unmount()
    expect(clearOffer).toHaveBeenCalled()
  })

  it('shows a rejected call as its message and publishes nothing', () => {
    const publishOffer = vi.fn()
    const view = render(<ParallelSessionsRow {...props(settled({
      content: [{ type: 'text', text: 'invalid tasks: at most 4 tasks may be suggested (got 5)' }],
      isError: true,
    }), { publishOffer, clearOffer: vi.fn() })} />)
    expect(view.getByText('invalid tasks: at most 4 tasks may be suggested (got 5)')).toBeTruthy()
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(publishOffer).not.toHaveBeenCalled()
    expect(view.queryByRole('button')).toBeNull()
  })

  it('publishes nothing while the arguments are still an incomplete stream', () => {
    const publishOffer = vi.fn()
    const view = render(<ParallelSessionsRow {...props(settled({
      call: { name: 'suggest_parallel_sessions', argsRaw: '{"tasks":[{"title":"Wait' },
    }), { publishOffer, clearOffer: vi.fn() })} />)
    expect(view.getByText('Suggested 0 parallel sessions')).toBeTruthy()
    expect(view.queryByText('In the header')).toBeNull()
    expect(publishOffer).not.toHaveBeenCalled()
  })
})
