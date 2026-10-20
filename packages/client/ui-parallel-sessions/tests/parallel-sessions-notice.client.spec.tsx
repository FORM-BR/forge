// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
// Type-only: pulls the locale namespace merge this package declares.
import type {} from '../src/client/index.ts'
import { ParallelSessionsNotice } from '../src/client/ParallelSessionsNotice.tsx'
import { createParallelOfferStore } from '../src/client/offer-store.ts'
import { en } from '../src/client/locales.ts'

type NoticeProps = Parameters<typeof ParallelSessionsNotice>[0]

const SESSION = 'session-offer' as SessionId
const t: NoticeProps['t'] = makeTranslate(en, commonEn)
const TASKS = [
  { title: 'Waitlist copy', prompt: 'Rewrite the waitlist page copy to name the launch date.' },
  { title: 'Pricing table', prompt: 'Compare the three plans and list the missing rows.' },
]

afterEach(cleanup)

/**
 * Compose the chain runtime the card reads plus the injected offer store and verbs.
 * @param offers - the store the row would have published into.
 * @param over - replaced injected verbs or owner data.
 * @returns the component props.
 */
function props(offers: ReturnType<typeof createParallelOfferStore>, over: Partial<NoticeProps> = {}): NoticeProps {
  return {
    sessionId: SESSION,
    useParallelOffer: (selector: (offers: ReturnType<typeof createParallelOfferStore>['state']['getSnapshot'] extends () => infer T ? T : never) => unknown) =>
      selector(offers.state.getSnapshot()),
    startSession: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(),
    settle: vi.fn(),
    t,
    ...over,
  } as unknown as NoticeProps
}

describe('ParallelSessionsNotice', () => {
  it('renders nothing while the Session holds no offer', () => {
    const offers = createParallelOfferStore()
    const view = render(<ParallelSessionsNotice {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
  })

  it('lists the offered tasks and starts the chosen one where the user picks', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const startSession = vi.fn(() => Promise.resolve())
    const settle = vi.fn()
    const view = render(<ParallelSessionsNotice {...props(offers, { startSession, settle })} />)
    expect(view.getByText('Suggested 2 parallel sessions')).toBeTruthy()
    expect(view.getByText('Waitlist copy')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in this workspace' }))
    expect(startSession).toHaveBeenCalledWith(TASKS[0], 'local')
    await waitFor(() => { expect(settle).toHaveBeenCalledWith('Waitlist copy') })
  })

  it('offers a worktree checkout as the other place to start the session', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const startSession = vi.fn(() => Promise.resolve())
    render(<ParallelSessionsNotice {...props(offers, { startSession })} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in a git worktree' }))
    expect(startSession).toHaveBeenCalledWith(TASKS[1], 'worktree')
  })

  it('keeps a task that failed to start', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const settle = vi.fn()
    render(<ParallelSessionsNotice {...props(offers, {
      startSession: vi.fn(() => Promise.reject(new Error('host refused'))),
      settle,
    })} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in this workspace' }))
    await waitFor(() => { expect(screen.getByText('Could not start the session')).toBeTruthy() })
    expect(settle).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2)
  })

  it('dismisses the whole offer from its header', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const dismiss = vi.fn()
    render(<ParallelSessionsNotice {...props(offers, { dismiss })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close card' }))
    expect(dismiss).toHaveBeenCalled()
  })

  it('shows only this Session offer and disappears once every task settled', () => {
    const offers = createParallelOfferStore()
    offers.publish('session-other' as SessionId, { callId: 'call-2', tasks: TASKS })
    const view = render(<ParallelSessionsNotice {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()

    offers.publish(SESSION, { callId: 'call-1', tasks: [TASKS[0]!] })
    view.rerender(<ParallelSessionsNotice {...props(offers)} />)
    expect(view.getByText('Suggested 1 parallel sessions')).toBeTruthy()

    offers.settle(SESSION, 'Waitlist copy')
    view.rerender(<ParallelSessionsNotice {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
  })
})
