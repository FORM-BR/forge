// @vitest-environment jsdom
/** Fold-all control and corner-resizable card of the model list pane. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { createModelMenuStore } from '../src/client/menu-store.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'

const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function state(groupCount: number): ModelDirectoryState {
  return {
    current: { provider: 'alpha', model: 'alpha-small' },
    routable: true,
    groups: [
      { id: 'alpha', name: 'Alpha', models: [{ id: 'alpha-small', name: 'Alpha Small' }] },
      { id: 'beta', name: 'Beta', models: [{ id: 'beta-one', name: 'Beta One' }] },
    ].slice(0, groupCount),
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  }
}

function mount(groupCount = 2, instance = createModelMenuStore().create()) {
  const directory = createSnapshotStore<ModelDirectoryState>(state(groupCount))
  render(<ModelSelect
    useStore={bindSnapshotSelector(instance)}
    actions={instance.actions}
    locked={false}
    available
    directory={directory}
    load={vi.fn()}
    select={vi.fn()}
    t={t}
  />)
  fireEvent.click(screen.getByRole('button', { name: /选择模型，当前 Alpha Small/ }))
  return instance
}

const openModelList = (): void => { fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ })) }

afterEach(cleanup)
afterEach(() => { localStorage.clear() })

describe('ModelSelect fold-all control', () => {
  it('folds every provider at once and unfolds them again', () => {
    mount()
    openModelList()
    fireEvent.click(screen.getByRole('menuitem', { name: '全部折叠' }))
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: 'Beta' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByRole('menuitemradio')).toEqual([])

    fireEvent.click(screen.getByRole('menuitem', { name: '全部展开' }))
    expect(screen.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual(['Alpha Small', 'Beta One'])
  })

  it('still offers to fold all after one provider was folded by hand', () => {
    mount()
    openModelList()
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
    expect(screen.getByRole('menuitem', { name: '全部折叠' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '全部折叠' }))
    expect(screen.getByRole('menuitem', { name: '全部展开' })).toBeTruthy()
  })

  it('is absent with a single provider', () => {
    mount(1)
    openModelList()
    expect(screen.queryByRole('menuitem', { name: '全部折叠' })).toBeNull()
  })
})

describe('ModelSelect resizable card', () => {
  const rect = { left: 400, top: 100, width: 300, height: 400 }
  const captured = new Set<number>()

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 800)
    // jsdom has no layout and no pointer capture: the card reports a fixed rectangle.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = this.getAttribute('role') === 'menu' ? rect : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
    })
    Object.assign(Element.prototype, {
      setPointerCapture: (id: number) => { captured.add(id) },
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => { captured.delete(id) },
    })
  })

  afterEach(() => {
    captured.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const name of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
      Reflect.deleteProperty(Element.prototype, name)
    }
  })

  const grip = (corner: string) => document.querySelector<HTMLElement>(`[data-corner="${corner}"]`)!
  const card = () => screen.getByRole('menu')
  const fire = (corner: string, type: string, init: PointerEventInit): void => {
    act(() => { grip(corner).dispatchEvent(new PointerEvent(type, { bubbles: true, ...init })) })
  }
  function drag(corner: string, from: [number, number], to: [number, number]): void {
    fire(corner, 'pointerdown', { pointerId: 1, clientX: from[0], clientY: from[1], button: 0 })
    fire(corner, 'pointermove', { pointerId: 1, clientX: to[0], clientY: to[1] })
    fire(corner, 'pointerup', { pointerId: 1, clientX: to[0], clientY: to[1] })
  }

  it('shows the grips only on the model list', () => {
    mount()
    expect(document.querySelectorAll('[data-corner]')).toHaveLength(0)
    openModelList()
    expect(document.querySelectorAll('[data-corner]')).toHaveLength(4)
    expect(grip('nw').getAttribute('title')).toBe('拖动以调整大小')
  })

  it('drags the top-left corner: the card grows toward the pointer and the size is saved', () => {
    const instance = mount()
    openModelList()
    drag('nw', [400, 100], [300, 50])
    expect(card().style.left).toBe('300px')
    expect(card().style.top).toBe('50px')
    expect(card().style.width).toBe('400px')
    expect(card().style.height).toBe('450px')
    expect(instance.getSnapshot().size).toEqual({ width: 400, height: 450 })
  })

  it('drags the bottom-right corner and keeps the top-left fixed', () => {
    const instance = mount()
    openModelList()
    drag('se', [700, 500], [760, 560])
    expect(card().style.left).toBe('400px')
    expect(card().style.top).toBe('100px')
    expect(instance.getSnapshot().size).toEqual({ width: 360, height: 460 })
  })

  it('saves nothing for a press without movement and ignores other buttons and pointers', () => {
    const instance = mount()
    openModelList()
    fire('ne', 'pointerdown', { pointerId: 1, button: 2 })
    fire('ne', 'pointerdown', { pointerId: 1, button: 0 })
    fire('ne', 'pointerdown', { pointerId: 2, button: 0 })
    fire('ne', 'pointermove', { pointerId: 2, clientX: 5 })
    fire('ne', 'pointerup', { pointerId: 2 })
    fire('ne', 'pointercancel', { pointerId: 1 })
    // A cancel with no drag in progress does nothing.
    fire('ne', 'pointercancel', { pointerId: 1 })
    expect(instance.getSnapshot().size).toBeNull()
  })

  it('ends the drag when the browser already released the pointer capture', () => {
    const instance = mount()
    openModelList()
    fire('se', 'pointerdown', { pointerId: 1, button: 0, clientX: 700, clientY: 500 })
    fire('se', 'pointermove', { pointerId: 1, clientX: 720, clientY: 520 })
    captured.clear()
    fire('se', 'pointercancel', { pointerId: 1 })
    expect(instance.getSnapshot().size).toEqual({ width: 320, height: 420 })
  })

  it('reopens at the saved size, clamped to the window, on the model list only', () => {
    const instance = createModelMenuStore().create()
    instance.actions.setSize(5000, 20)
    mount(2, instance)
    openModelList()
    expect(card().style.width).toBe('720px')
    expect(card().style.height).toBe('160px')
    fireEvent.keyDown(card(), { key: 'Escape' })
    expect(card().style.width).toBe('')
  })

  it('forgets the live drag position when the card closes', () => {
    mount()
    openModelList()
    drag('nw', [400, 100], [300, 50])
    const trigger = screen.getByRole('button', { name: /选择模型，当前/ })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    openModelList()
    expect(card().style.width).toBe('400px')
    expect(card().style.left).not.toBe('300px')
  })
})
