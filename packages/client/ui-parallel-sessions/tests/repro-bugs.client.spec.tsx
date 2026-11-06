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
    dismiss: vi.fn((sessionId: SessionId) => { offers.dismiss(sessionId) }),
    settle: vi.fn((sessionId: SessionId) => { offers.dismiss(sessionId) }),
    t,
    ...over,
  } as unknown as ActionProps
}

describe('ParallelSessionsAction (reprodução dos bugs relatados)', () => {
  it('um erro síncrono de startSession NÃO deve prender a tarefa em "abrir" para sempre', async () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const syncThrow = vi.fn(() => { throw new Error('sync boom') })
    render(<ParallelSessionsAction {...props(offers, { startSession: syncThrow })} />)
    fireEvent.click(screen.getByRole('button', { name: '1 parallel sessions suggested' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Local' }))
    // Com o bug: a tarefa fica em "starting" (botão desabilitado, sem mensagem de erro).
    await waitFor(() => { expect(screen.queryByText('Could not start the session')).not.toBeNull() })
  })

  it('APÓS DECLINAR, a oferta NÃO pode ressuscitar quando a row remontar (publish após clear)', () => {
    const offers = createParallelOfferStore()
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    const view = render(<ParallelSessionsAction {...props(offers)} />)
    fireEvent.click(screen.getByRole('button', { name: '1 parallel sessions suggested' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close card' }))
    // Recria o chip (dismiss grepped tasks=[]):
    view.rerender(<ParallelSessionsAction {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
    // A row sai e volta (virtualização/paginação): o clear apaga a entrada...
    offers.clear(SESSION)
    // ...e o publish da remontagem NÃO pode trazer a oferta de volta.
    offers.publish(SESSION, { callId: 'call-1', tasks: TASKS })
    view.rerender(<ParallelSessionsAction {...props(offers)} />)
    expect(view.container.firstChild).toBeNull()
  })
})
