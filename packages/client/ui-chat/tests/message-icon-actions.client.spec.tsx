// @vitest-environment jsdom
/** Rewind/branch chrome: confirmation popover, inert states, and copy feedback. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { MessageIconActions, type MessageIconActionsProps } from '../src/client/chat/MessageIconActions.tsx'

afterEach(cleanup)

const t: MessageIconActionsProps['t'] = makeTranslate(zh, commonZh)

function actions(overrides: Partial<MessageIconActionsProps> = {}) {
  return render(
    <MessageIconActions text="hello" clock="start" onRewind={() => {}} onBranch={() => {}} t={t} {...overrides} />,
  )
}

describe('MessageIconActions rewind and branch', () => {
  it('runs rewind immediately when the cut needs no confirmation', () => {
    const onRewind = vi.fn()
    actions({ onRewind })
    fireEvent.click(screen.getByRole('button', { name: '退回到这里' }))
    expect(onRewind).toHaveBeenCalledOnce()
    expect(screen.queryByText(zh['message.rewindConfirm.body'])).toBeNull()
  })

  it('asks for confirmation and only rewinds after accepting', () => {
    const onRewind = vi.fn()
    actions({ onRewind, rewindConfirmRequired: true })
    fireEvent.click(screen.getByRole('button', { name: '退回到这里' }))
    expect(onRewind).not.toHaveBeenCalled()
    const body = screen.getByText(zh['message.rewindConfirm.body'])
    const popover = body.parentElement?.parentElement as HTMLElement
    fireEvent.click(within(popover).getByRole('button', { name: zh['message.rewindConfirm.accept'] }))
    expect(onRewind).toHaveBeenCalledOnce()
  })

  it('dismisses the confirmation without rewinding when cancelling', () => {
    const onRewind = vi.fn()
    actions({ onRewind, rewindConfirmRequired: true })
    fireEvent.click(screen.getByRole('button', { name: '退回到这里' }))
    const body = screen.getByText(zh['message.rewindConfirm.body'])
    const popover = body.parentElement?.parentElement as HTMLElement
    fireEvent.click(within(popover).getByRole('button', { name: zh['message.rewindConfirm.cancel'] }))
    expect(onRewind).not.toHaveBeenCalled()
    expect(screen.queryByText(zh['message.rewindConfirm.body'])).toBeNull()
  })

  it('never opens a confirmation for branch', () => {
    const onBranch = vi.fn()
    actions({ onBranch, rewindConfirmRequired: true })
    fireEvent.click(screen.getByRole('button', { name: '在新对话中分支' }))
    expect(onBranch).toHaveBeenCalledOnce()
    expect(screen.queryByText(zh['message.rewindConfirm.body'])).toBeNull()
  })

  it('keeps both actions inert while a turn is running', () => {
    const onRewind = vi.fn()
    const onBranch = vi.fn()
    actions({ onRewind, onBranch, disabledWhileRunning: true })
    const rewind = screen.getByRole('button', { name: '退回到这里' })
    const branch = screen.getByRole('button', { name: '在新对话中分支' })
    expect(rewind.getAttribute('aria-disabled')).toBe('true')
    expect(branch.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(rewind)
    fireEvent.click(branch)
    expect(onRewind).not.toHaveBeenCalled()
    expect(onBranch).not.toHaveBeenCalled()
    // The reason reaches assistive technology, not only the pointer tooltip;
    // each action carries its own described-by copy.
    expect(screen.getAllByText(zh['message.actionsDisabledWhileRunning'])).toHaveLength(2)
  })

  it('keeps both actions inert when the message is unavailable', () => {
    const onBranch = vi.fn()
    actions({ unavailable: true })
    fireEvent.click(screen.getByRole('button', { name: '在新对话中分支' }))
    expect(onBranch).not.toHaveBeenCalled()
  })

  it('renders neither action when both callbacks are omitted', () => {
    actions({ onRewind: undefined, onBranch: undefined })
    expect(screen.queryByRole('button', { name: '退回到这里' })).toBeNull()
    expect(screen.queryByRole('button', { name: '在新对话中分支' })).toBeNull()
  })
})
