// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
// Type-only: pulls the locale namespace merge this package declares.
import type {} from '../src/client/index.ts'
import { ParallelSessionsAction } from '../src/client/ParallelSessionsAction.tsx'
import { createParallelOfferStore, type ParallelOfferMap } from '../src/client/offer-store.ts'
import { en } from '../src/client/locales.ts'

type ActionProps = Parameters<typeof ParallelSessionsAction>[0]

const SESSION = 'session-offer' as SessionId
const t: ActionProps['t'] = makeTranslate(en, commonEn)
const TASKS = [
  { title: 'Waitlist copy', prompt: 'Rewrite the waitlist page copy to name the launch date.' },
  { title: 'Pricing table', prompt: 'Compare the three plans and list the missing rows.' },
]

afterEach(cleanup)

/**
 * Compose the header-action owner data plus the injected offer store and verbs.
 * @param offers - the store the transcript row would have published into.
 * @param over - replaced injected verbs or owner data.
 * @returns the component props.
 */
function props(offers: ReturnType<typeof createParallelOfferStore>, over: Partial<ActionProps> = {}): ActionProps {
  return {
    sessionId: SESSION,
    useParallelOffer: (selector: (value: ParallelOfferMap) => unknown) => selector(offers.state.getSnapshot()),
    startSession: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(),
    settle: vi.fn(),
    t,
    ...over,
  } as unknown as ActionProps
}

describe('ParallelSessionsAction', () => {
  it('renders nothing while the Session holds no offer', () => {
    const offers = createParallelOfferStore()
    const view = render(<ParallelSessionsAction {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
  })

  it('keeps the offer collapsed to a chip in the header', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    render(<ParallelSessionsAction {...props(offers)} />)
    const chip = screen.getByRole('button', { name: '2 parallel sessions suggested' })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('2 sessions')).toBeTruthy()
    // Collapsed, the offer covers no transcript text: the task list is absent.
    expect(screen.queryByText('Waitlist copy')).toBeNull()
  })

  it('lists the tasks only once expanded, each prompt behind its details control', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    render(<ParallelSessionsAction {...props(offers)} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    expect(screen.getByText('Waitlist copy')).toBeTruthy()
    expect(screen.queryByText(TASKS[0]!.prompt)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Task details' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)
  })

  it('starts the chosen task where the user picks and drops it from the list', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const startSession = vi.fn(() => Promise.resolve())
    const settle = vi.fn()
    render(<ParallelSessionsAction {...props(offers, { startSession, settle })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local' }))
    expect(startSession).toHaveBeenCalledWith(SESSION, TASKS[0], 'local')
    await waitFor(() => { expect(settle).toHaveBeenCalledWith(SESSION, 'Waitlist copy') })
  })

  it('offers a worktree checkout as the other place to start the session', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const startSession = vi.fn(() => Promise.resolve())
    render(<ParallelSessionsAction {...props(offers, { startSession })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Worktree' }))
    expect(startSession).toHaveBeenCalledWith(SESSION, TASKS[1], 'worktree')
  })

  it('keeps a task that failed to start', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const settle = vi.fn()
    render(<ParallelSessionsAction {...props(offers, {
      startSession: vi.fn(() => Promise.reject(new Error('host refused'))),
      settle,
    })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local' }))
    await waitFor(() => { expect(screen.getByText('Could not start the session')).toBeTruthy() })
    expect(settle).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)
  })

  it('dismisses the whole offer from the expanded list', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const dismiss = vi.fn()
    render(<ParallelSessionsAction {...props(offers, { dismiss })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close card' }))
    expect(dismiss).toHaveBeenCalledWith(SESSION)
  })

  it('collapses on Escape', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const view = render(<ParallelSessionsAction {...props(offers)} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.keyDown(view.container.firstChild as Element, { key: 'Escape' })
    expect(screen.queryByText('Waitlist copy')).toBeNull()
  })

  it('shows only this Session offer and disappears once every task settled', () => {
    const offers = createParallelOfferStore()
    offers.publish('session-other' as SessionId, { callId: 'call-2', tasks: TASKS })
    const view = render(<ParallelSessionsAction {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()

    offers.publish(SESSION, { callId: 'call-1', tasks: [TASKS[0]!] })
    view.rerender(<ParallelSessionsAction {...props(offers)} />)
    expect(view.getByText('1 sessions')).toBeTruthy()

    offers.settle(SESSION, 'Waitlist copy')
    view.rerender(<ParallelSessionsAction {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
  })
})
