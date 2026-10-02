// @vitest-environment jsdom
/** The agent-loop page as the Plugins page renders it: its one-liner and its one field. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentLoopCard, type AgentLoopCardProps } from '../src/client/AgentLoopCard.tsx'
import type { AgentLoopCardState } from '../src/client/agent-loop-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function renderCard(state: Partial<AgentLoopCardState> = {}, view: 'summary' | 'page' = 'page') {
  const store = createSnapshotStore<AgentLoopCardState>({
    ...settled, maxParallelToolCalls: field('10'), directMode: field('false'), ...state,
  })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, view, t, useAgentLoopCard: bindSnapshotSelector(store) } as AgentLoopCardProps
  render(<AgentLoopCard {...props} />)
  return actions
}

describe('AgentLoopCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderCard({}, 'summary')

    expect(document.body.textContent).toBe(en.description)
    expect(screen.queryByLabelText(en.maxParallel)).toBeNull()
  })

  it('stages and saves the only field it owns', () => {
    const actions = renderCard({ dirty: true })

    fireEvent.change(screen.getByLabelText(en.maxParallel), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(actions.edit).toHaveBeenCalledWith('maxParallelToolCalls', '2')
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('stages a reset for the field it owns', () => {
    const actions = renderCard({ maxParallelToolCalls: field('2', { overridden: true }) })

    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.resetField).toHaveBeenCalledWith('maxParallelToolCalls')
  })

  it('stages the direct-mode switch as text and writes nothing until save', () => {
    const actions = renderCard()
    const toggle = screen.getByRole('switch', { name: en.directMode })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)

    expect(actions.edit).toHaveBeenCalledWith('directMode', 'true')
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('shows direct mode on, stages turning it off, and resets an override', () => {
    const actions = renderCard({ directMode: field('true', { overridden: true }) })
    const toggle = screen.getByRole('switch', { name: en.directMode })
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: en.reset }))

    expect(actions.edit).toHaveBeenCalledWith('directMode', 'false')
    expect(actions.resetField).toHaveBeenCalledWith('directMode')
  })

  it('says the plugin is not loaded while its namespace is unavailable, and disables the field while the document is read-only', () => {
    renderCard({ available: false })
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    cleanup()

    renderCard({ writable: false })
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByLabelText(en.maxParallel)).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: en.directMode })).toHaveProperty('disabled', true)
  })
})
