// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
 * Compose the keyed toolview owner plus the card's locale seat and injected action.
 * @param block - the settled result or the preparing placeholder.
 * @param startSession - the injected start action.
 * @returns the component props.
 */
function props(block: RowProps['block'], startSession: ParallelSessionsInjected['startSession']): RowProps {
  return {
    callId: block.callId,
    toolName: 'suggest_parallel_sessions',
    ...('kind' in block ? { phase: 'result' as const, block } : { phase: block.phase, block }),
    useDisclosure: () => ({ expanded: false, setExpanded: vi.fn(), toggle: vi.fn() }),
    loadImage: vi.fn(),
    openFile: vi.fn(),
    t,
    startSession,
  } as RowProps
}

describe('ParallelSessionsRow', () => {
  it('names the offer while the call is still preparing', () => {
    const view = render(<ParallelSessionsRow {...props({
      phase: 'preparing', callId: 'call-parallel', name: 'suggest_parallel_sessions', turn: 1, step: 1, time: 1, subCalls: [],
    }, vi.fn())} />)
    expect(view.getAllByText('Suggesting parallel sessions').length).toBeGreaterThan(0)
    expect(view.queryByRole('button')).toBeNull()
  })

  it('lists every offered task with its prompt and starts the chosen one', async () => {
    const startSession = vi.fn<(task: { title: string; prompt: string }) => Promise<void>>(() => Promise.resolve())
    const view = render(<ParallelSessionsRow {...props(settled(), startSession)} />)
    expect(view.getByText('Suggested 2 parallel sessions')).toBeTruthy()
    expect(view.getByText('Waitlist copy')).toBeTruthy()
    expect(view.getByText('Compare the three plans and list the missing rows.')).toBeTruthy()
    expect(view.getAllByRole('button', { name: 'Open session' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Open session' })[0]!)
    expect(startSession).toHaveBeenCalledWith(TASKS[0])
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Opened' })).toBeTruthy() })
    expect(screen.getAllByRole('button', { name: 'Open session' })).toHaveLength(1)
  })

  it('reports a failed start without losing the other tasks', async () => {
    const startSession = vi.fn(() => Promise.reject(new Error('host refused')))
    render(<ParallelSessionsRow {...props(settled(), startSession)} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open session' })[0]!)
    await waitFor(() => { expect(screen.getByText('Could not start the session')).toBeTruthy() })
    expect(screen.getAllByRole('button', { name: 'Open session' })).toHaveLength(2)
  })

  it('shows a rejected call as its message rather than as tasks', () => {
    const view = render(<ParallelSessionsRow {...props(settled({
      content: [{ type: 'text', text: 'invalid tasks: at most 4 tasks may be suggested (got 5)' }],
      isError: true,
    }), vi.fn())} />)
    expect(view.getByText('invalid tasks: at most 4 tasks may be suggested (got 5)')).toBeTruthy()
    expect(view.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(view.queryByRole('button')).toBeNull()
  })
})
