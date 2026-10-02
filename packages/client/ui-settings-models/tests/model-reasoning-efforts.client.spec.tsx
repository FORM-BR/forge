// @vitest-environment jsdom
/** Reasoning-level declarations: wire spellings, the off exception, and preserved model metadata. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Model = Record<string, unknown>

function mount(model: Model, disabled = false): ReturnType<typeof vi.fn> {
  const onChange = vi.fn()
  render(<ModelReasoningEfforts
    model={model} position={2} disabled={disabled} t={key => en[key]} onChange={onChange}
  />)
  return onChange
}

const checkbox = (name: string): HTMLInputElement => screen.getByRole<HTMLInputElement>('checkbox', { name })

describe('reasoning levels', () => {
  it('labels the group by row and shows nothing checked for an inherited capability', () => {
    mount({ id: 'm' })
    expect(screen.getByRole('group', { name: `${en.modelReasoning} 2` })).toBeTruthy()
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every(box => !box.checked)).toBe(true)
  })

  it('writes a checked level under its own name and keeps unrelated metadata', () => {
    const model = { id: 'm', contextWindow: 123_456, compat: { thinkingFormat: 'openrouter' } }
    const onChange = mount(model)
    fireEvent.click(checkbox(en.modelReasoningHigh))
    expect(onChange).toHaveBeenCalledWith({ ...model, reasoningEfforts: { high: 'high' } })
    expect(model).not.toHaveProperty('reasoningEfforts')
  })

  it('writes off valueless so the endpoint keeps its own off spelling', () => {
    const onChange = mount({ id: 'm', reasoningEfforts: { high: 'high' } })
    fireEvent.click(checkbox(en.modelReasoningOff))
    expect(onChange).toHaveBeenCalledWith({ id: 'm', reasoningEfforts: { high: 'high', off: null } })
  })

  it('keeps off unavailable until a level beside it is declared', () => {
    mount({ id: 'm' })
    expect(checkbox(en.modelReasoningOff).disabled).toBe(true)
    expect(checkbox(en.modelReasoningLow).disabled).toBe(false)
  })

  it('lets a hand-written off-only declaration be cleared', () => {
    const onChange = mount({ id: 'm', reasoningEfforts: { off: null } })
    expect(checkbox(en.modelReasoningOff).checked).toBe(true)
    expect(checkbox(en.modelReasoningOff).disabled).toBe(false)
    fireEvent.click(checkbox(en.modelReasoningOff))
    expect(onChange).toHaveBeenCalledWith({ id: 'm' })
  })

  it('preserves a custom wire spelling while another level changes', () => {
    const onChange = mount({ id: 'm', reasoningEfforts: { high: 'ultra', low: 'low' } })
    fireEvent.click(checkbox(en.modelReasoningLow))
    expect(onChange).toHaveBeenCalledWith({ id: 'm', reasoningEfforts: { high: 'ultra' } })
  })

  it('drops the field when the last real level is unchecked, offered off included', () => {
    const onChange = mount({ id: 'm', name: 'Kept', reasoningEfforts: { off: null, high: 'high' } })
    fireEvent.click(checkbox(en.modelReasoningHigh))
    expect(onChange).toHaveBeenCalledWith({ id: 'm', name: 'Kept' })
  })

  it('reads an explicit non-reasoning model as nothing declared', () => {
    const onChange = mount({ id: 'm', reasoningEfforts: false })
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every(box => !box.checked)).toBe(true)
    fireEvent.click(checkbox(en.modelReasoningMedium))
    expect(onChange).toHaveBeenCalledWith({ id: 'm', reasoningEfforts: { medium: 'medium' } })
  })

  it('disables every level while read-only or saving', () => {
    const onChange = mount({ id: 'm', reasoningEfforts: { high: 'high' } }, true)
    for (const box of screen.getAllByRole<HTMLInputElement>('checkbox')) {
      expect(box.disabled).toBe(true)
      box.click()
    }
    expect(onChange).not.toHaveBeenCalled()
  })
})
