// @vitest-environment jsdom
/** O sino lista os avisos, abre a sessão ao clicar e grava as preferências. */
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject, UI_TURN_NOTIFY_ID } from '../src/client/index.ts'
import { NotifyController, type NotifyEnv, type StatusLike } from '../src/client/controller.ts'
import { en, zh } from '../src/client/locales.ts'
import { TurnNotifyHost, type TurnNotifyHostProps } from '../src/client/TurnNotifyHost.tsx'

afterEach(() => { cleanup() })

const t = (key: string, vars?: Record<string, string>): string =>
  (en as Record<string, string>)[key]?.replace('{n}', vars?.['n'] ?? '') ?? key

function setup() {
  const opened: string[] = []
  const env: NotifyEnv = {
    now: () => Date.now(),
    storage: undefined,
    isAway: () => true,
    chime: () => {},
    system: () => {},
    requestPermission: async () => 'granted',
    permission: () => 'granted',
    badge: () => {},
    open: (id) => { opened.push(id) },
  }
  const controller = new NotifyController(env)
  const labels = { done: 'done', attention: 'attention' }
  const byId = { a: { displayTitle: 'Refatorar login', retainedBy: {} }, b: { displayTitle: 'Migrar tabela', retainedBy: {} } }
  const props = (statuses: Map<string, StatusLike>) => ({
    useSessionStatus: (select: (value: Map<string, StatusLike>) => unknown) => select(statuses),
    useSessions: (select: (value: { byId: typeof byId }) => unknown) => select({ byId }),
    controller,
    t,
  }) as unknown as TurnNotifyHostProps
  const running = new Map<string, StatusLike>([['a', { running: true, pendingInteraction: undefined }], ['b', { running: true, pendingInteraction: undefined }]])
  const idle = new Map<string, StatusLike>([['a', { running: false, pendingInteraction: undefined }], ['b', { running: true, pendingInteraction: { key: 'q' } }]])
  return { controller, opened, props, running, idle, labels }
}

it('mostra o contador, lista os avisos e abre a sessão do aviso clicado', () => {
  const h = setup()
  const view = render(createElement(TurnNotifyHost, h.props(h.running)))
  act(() => { view.rerender(createElement(TurnNotifyHost, h.props(h.idle))) })

  const bell = screen.getByRole('button', { name: 'Task alerts' })
  expect(bell.textContent).toContain('2')
  fireEvent.click(bell)
  expect(screen.getByText('Refatorar login')).toBeTruthy()
  expect(screen.getByText(/Turn ended/)).toBeTruthy()
  expect(screen.getByText(/Needs your input/)).toBeTruthy()

  fireEvent.click(screen.getByText('Migrar tabela'))
  expect(h.opened).toEqual(['b'])
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('fechar o painel marca os avisos como lidos e some o contador', () => {
  const h = setup()
  const view = render(createElement(TurnNotifyHost, h.props(h.running)))
  act(() => { view.rerender(createElement(TurnNotifyHost, h.props(h.idle))) })
  const bell = screen.getByRole('button', { name: 'Task alerts' })
  fireEvent.click(bell)
  fireEvent.click(bell)
  expect(h.controller.getSnapshot().unread).toBe(0)
  expect(bell.textContent).not.toContain('2')
})

it('Escape fecha o painel e as chaves gravam a preferência', async () => {
  const h = setup()
  const setPref = vi.spyOn(h.controller, 'setPref')
  render(createElement(TurnNotifyHost, h.props(h.running)))
  fireEvent.click(screen.getByRole('button', { name: 'Task alerts' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Sound' }))
  expect(setPref).toHaveBeenCalledWith('sound', false)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('o plugin registra o dicionário e a entrada em shell.overlay e libera tudo ao descarregar', async () => {
  const ctx = new Context()
  const entries: { name: string; id?: string; locale: string }[] = []
  const dictionaries = new Map<string, unknown>()
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: { name: string; id?: string; locale: string }) => {
      entries.push(options)
      return () => { entries.splice(entries.indexOf(options), 1) }
    },
  } as never)
  ctx.provide('locale', {
    bind: () => (key: string) => key,
    register: (name: string, values: unknown) => { dictionaries.set(name, values); return () => { dictionaries.delete(name) } },
  } as never)
  ctx.provide('uiWorkspace', { openSession: vi.fn() } as never)
  const fiber = await ctx.plugin({ inject, apply })
  expect(entries).toEqual([expect.objectContaining({ name: 'shell.overlay', id: UI_TURN_NOTIFY_ID, locale: 'turnNotify' })])
  expect(dictionaries.get('turnNotify')).toEqual({ zh, en })
  await fiber.dispose()
  expect(entries).toEqual([])
  expect(dictionaries.size).toBe(0)
  await ctx.fiber.dispose()
})

it('en e zh têm as mesmas chaves', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
})
