// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
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

/** One loaded catalog group with a reasoning-capable model and a plain one. */
const MODEL_STATE: ModelDirectoryState = {
  current: null,
  routable: true,
  groups: [{
    id: 'deepseek-account',
    name: 'DeepSeek Account',
    models: [
      {
        id: 'model-a',
        name: 'Model A',
        reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
      },
      { id: 'model-b', name: 'Model B' },
    ],
  }],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
}

afterEach(cleanup)

/**
 * Compose the header-action owner data plus the injected offer store and verbs.
 * @param offers - the store the transcript row would have published into.
 * @param over - replaced injected verbs or owner data.
 * @param modelState - the shared model directory snapshot the picker reads.
 * @returns the component props.
 */
function props(
  offers: ReturnType<typeof createParallelOfferStore>,
  over: Partial<ActionProps> = {},
  modelState: ModelDirectoryState = MODEL_STATE,
): ActionProps {
  return {
    sessionId: SESSION,
    useParallelOffer: (selector: (value: ParallelOfferMap) => unknown) => selector(offers.state.getSnapshot()),
    useModelDirectory: (selector: (value: ModelDirectoryState) => unknown) => selector(modelState),
    loadModels: vi.fn(),
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
    expect(startSession).toHaveBeenCalledWith(SESSION, TASKS[0], 'local', undefined)
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
    expect(startSession).toHaveBeenCalledWith(SESSION, TASKS[1], 'worktree', undefined)
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

  it('shows the real failure text under the generic label', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: [TASKS[0]!] })
    render(<ParallelSessionsAction {...props(offers, {
      startSession: vi.fn(() => Promise.reject(new Error(
        'workspace worktree failed: workspace/worktree-failed: cannot create a worktree at "x": fatal: a branch named \'forge/w\' already exists',
      ))),
    })} />)
    fireEvent.click(screen.getByRole('button', { name: '1 parallel sessions suggested' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Worktree' }))
    await waitFor(() => { expect(screen.getByText(/already exists/)).toBeTruthy() })
  })

  it('collapses the panel on a successful start even with tasks remaining', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    render(<ParallelSessionsAction {...props(offers, {
      startSession: vi.fn(() => Promise.resolve()),
      settle: (sessionId: SessionId, title: string) => { offers.settle(sessionId, title) },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: '2 parallel sessions suggested' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local' }))
    await waitFor(() => { expect(screen.getByText('1 sessions')).toBeTruthy() })
    // The started task dropped from the offer AND the panel closed: no task rows show.
    expect(screen.queryByText('Pricing table')).toBeNull()
  })

  it('lets the user pick model and effort before starting, and starts on that selection', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: [TASKS[0]!] })
    const startSession = vi.fn(() => Promise.resolve())
    render(<ParallelSessionsAction {...props(offers, { startSession })} />)
    fireEvent.click(screen.getByRole('button', { name: '1 parallel sessions suggested' }))
    // Pick the model, then an explicit effort for it.
    fireEvent.click(screen.getByRole('button', { name: /Model/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Model A' }))
    fireEvent.click(screen.getByRole('button', { name: /Effort/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'High' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local' }))
    expect(startSession).toHaveBeenCalledWith(
      SESSION, TASKS[0], 'local', { provider: 'deepseek-account', model: 'model-a', reasoningEffort: 'high' },
    )
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
