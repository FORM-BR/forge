/** Detecção de transições, política de aviso e preferências da central. */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREFS, MAX_ENTRIES, NotifyController, PREFS_KEY, loadPrefs,
  type NoticeEntry, type NotifyEnv, type SessionLike, type StatusLike, type SystemPermission,
} from '../src/client/controller.ts'

const LABELS = { done: 'Task finished', attention: 'Waiting for your input' }

function memoryStorage(initial?: string): NonNullable<NotifyEnv['storage']> & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[PREFS_KEY, initial]])
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } }
}

function makeEnv(overrides: Partial<NotifyEnv> & { away?: boolean; initialPermission?: SystemPermission } = {}) {
  const calls = { chime: [] as string[], system: [] as [NoticeEntry, string][], badge: [] as number[], open: [] as string[] }
  let permission: SystemPermission = overrides.initialPermission ?? 'default'
  const env: NotifyEnv = {
    now: () => 1_000,
    storage: memoryStorage(),
    isAway: () => overrides.away ?? false,
    chime: (kind) => { calls.chime.push(kind) },
    system: (entry, body) => { calls.system.push([entry, body]) },
    requestPermission: vi.fn(async () => { permission = 'granted'; return permission }),
    permission: () => permission,
    badge: (count) => { calls.badge.push(count) },
    open: (id) => { calls.open.push(id) },
    ...overrides,
  }
  return { env, calls }
}

const status = (running: boolean | undefined, pending = false): StatusLike => ({ running, pendingInteraction: pending ? { key: 'k' } : undefined })
const statuses = (entries: Record<string, StatusLike>) => new Map(Object.entries(entries))
const session = (title: string, extra: Partial<SessionLike> = {}): SessionLike => ({ displayTitle: title, retainedBy: {}, ...extra })

describe('transições', () => {
  it('a primeira observação só estabelece a linha de base, sem avisar', () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    controller.observe(statuses({ a: status(false) }), { a: session('A') }, LABELS)
    expect(controller.getSnapshot().entries).toEqual([])
    expect(calls.chime).toEqual([])
  })

  it('running true → false sem pedido pendente vira "done" e toca o sinal', () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    controller.observe(statuses({ a: status(true) }), { a: session('Refatorar login') }, LABELS)
    controller.observe(statuses({ a: status(false) }), { a: session('Refatorar login') }, LABELS)
    const [entry] = controller.getSnapshot().entries
    expect(entry).toMatchObject({ sessionId: 'a', title: 'Refatorar login', kind: 'done', read: false })
    expect(calls.chime).toEqual(['done'])
    expect(controller.getSnapshot().unread).toBe(1)
    expect(calls.badge.at(-1)).toBe(1)
  })

  it('uma interação pendente nova vira "attention", e parar com pedido pendente não vira "done"', () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    const sessions = { a: session('A') }
    controller.observe(statuses({ a: status(true) }), sessions, LABELS)
    controller.observe(statuses({ a: status(true, true) }), sessions, LABELS)
    controller.observe(statuses({ a: status(false, true) }), sessions, LABELS)
    expect(controller.getSnapshot().entries.map(entry => entry.kind)).toEqual(['attention'])
    expect(calls.chime).toEqual(['attention'])
  })

  it('subagentes não geram aviso', () => {
    const { env } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    const sessions = { child: session('filho', { origin: 'subagent' }) }
    controller.observe(statuses({ child: status(true) }), sessions, LABELS)
    controller.observe(statuses({ child: status(false) }), sessions, LABELS)
    expect(controller.getSnapshot().entries).toEqual([])
  })

  it('guarda no máximo MAX_ENTRIES, os mais novos primeiro', () => {
    const { env } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    const sessions = { a: session('A') }
    controller.observe(statuses({ a: status(false) }), sessions, LABELS)
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
      controller.observe(statuses({ a: status(true) }), sessions, LABELS)
      controller.observe(statuses({ a: status(false) }), sessions, LABELS)
    }
    const { entries } = controller.getSnapshot()
    expect(entries).toHaveLength(MAX_ENTRIES)
    expect(entries[0]!.id).toBeGreaterThan(entries[1]!.id)
  })
})

describe('política "já estou olhando"', () => {
  const finish = (controller: NotifyController, sessions: Record<string, SessionLike>) => {
    controller.observe(statuses({ a: status(true) }), sessions, LABELS)
    controller.observe(statuses({ a: status(false) }), sessions, LABELS)
  }

  it('janela em foco com a sessão aberta: nenhum aviso', () => {
    const { env, calls } = makeEnv({ away: false })
    const controller = new NotifyController(env)
    finish(controller, { a: session('A', { retainedBy: { mainView: 1 } }) })
    expect(controller.getSnapshot().entries).toEqual([])
    expect(calls.chime).toEqual([])
  })

  it('janela em foco, mas em outra sessão: avisa', () => {
    const { env } = makeEnv({ away: false })
    const controller = new NotifyController(env)
    finish(controller, { a: session('A') })
    expect(controller.getSnapshot().entries).toHaveLength(1)
  })

  it('com onlyUnseen desligado avisa mesmo olhando', async () => {
    const { env } = makeEnv({ away: false })
    const controller = new NotifyController(env)
    await controller.setPref('onlyUnseen', false)
    finish(controller, { a: session('A', { retainedBy: { mainView: 1 } }) })
    expect(controller.getSnapshot().entries).toHaveLength(1)
  })

  it('avisos pendentes de uma sessão são marcados como lidos quando o usuário a abre em foco', () => {
    let away = true
    const { env } = makeEnv({ isAway: () => away })
    const controller = new NotifyController(env)
    finish(controller, { a: session('A') })
    expect(controller.getSnapshot().unread).toBe(1)
    away = false
    controller.observe(statuses({ a: status(false) }), { a: session('A', { retainedBy: { mainView: 1 } }) }, LABELS)
    expect(controller.getSnapshot().unread).toBe(0)
  })
})

describe('preferências e canais', () => {
  it('tudo desligado: nada é registrado', async () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    await controller.setPref('enabled', false)
    controller.observe(statuses({ a: status(true) }), { a: session('A') }, LABELS)
    controller.observe(statuses({ a: status(false) }), { a: session('A') }, LABELS)
    expect(controller.getSnapshot().entries).toEqual([])
    expect(calls.chime).toEqual([])
  })

  it('sem som: registra, mas não toca', async () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    await controller.setPref('sound', false)
    controller.observe(statuses({ a: status(true) }), { a: session('A') }, LABELS)
    controller.observe(statuses({ a: status(false) }), { a: session('A') }, LABELS)
    expect(controller.getSnapshot().entries).toHaveLength(1)
    expect(calls.chime).toEqual([])
  })

  it('notificação do sistema: pede permissão ao ligar e só dispara com a janela em segundo plano', async () => {
    let current: SystemPermission = 'default'
    const requestPermission = vi.fn(async (): Promise<SystemPermission> => { current = 'granted'; return current })
    const { env, calls } = makeEnv({ away: true, requestPermission, permission: () => current })
    const controller = new NotifyController(env)
    await controller.setPref('system', true)
    expect(requestPermission).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().prefs.system).toBe(true)
    controller.observe(statuses({ a: status(true) }), { a: session('A') }, LABELS)
    controller.observe(statuses({ a: status(false) }), { a: session('A') }, LABELS)
    expect(calls.system).toHaveLength(1)
    expect(calls.system[0]![1]).toBe('Task finished')
  })

  it('permissão negada mantém a preferência desligada', async () => {
    const { env } = makeEnv({ away: true, requestPermission: async () => 'denied', permission: () => 'denied' })
    const controller = new NotifyController(env)
    await controller.setPref('system', true)
    expect(controller.getSnapshot().prefs.system).toBe(false)
    expect(controller.getSnapshot().permission).toBe('denied')
  })

  it('persiste as preferências e as recarrega', async () => {
    const storage = memoryStorage()
    const { env } = makeEnv({ storage })
    await new NotifyController(env).setPref('sound', false)
    expect(JSON.parse(storage.data.get(PREFS_KEY)!)).toMatchObject({ sound: false, enabled: true })
    expect(loadPrefs(storage).sound).toBe(false)
  })

  it('loadPrefs tolera armazenamento ausente, quebrado e campos inválidos', () => {
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(loadPrefs(memoryStorage('{não é json'))).toEqual(DEFAULT_PREFS)
    expect(loadPrefs(memoryStorage('[1]'))).toEqual(DEFAULT_PREFS)
    expect(loadPrefs(memoryStorage('{"sound":"sim","enabled":false}'))).toEqual({ ...DEFAULT_PREFS, enabled: false })
    const blocked = { getItem: () => { throw new Error('bloqueado') }, setItem: () => {} }
    expect(loadPrefs(blocked)).toEqual(DEFAULT_PREFS)
  })
})

describe('central', () => {
  function withTwo() {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    const sessions = { a: session('A'), b: session('B') }
    controller.observe(statuses({ a: status(true), b: status(true) }), sessions, LABELS)
    controller.observe(statuses({ a: status(false), b: status(false) }), sessions, LABELS)
    return { controller, calls }
  }

  it('abrir um aviso navega até a sessão e marca como lido só a dela', () => {
    const { controller, calls } = withTwo()
    const target = controller.getSnapshot().entries.find(entry => entry.sessionId === 'a')!
    controller.openEntry(target.id)
    expect(calls.open).toEqual(['a'])
    expect(controller.getSnapshot().unread).toBe(1)
  })

  it('marcar tudo como lido e limpar', () => {
    const { controller } = withTwo()
    controller.markAllRead()
    expect(controller.getSnapshot().unread).toBe(0)
    expect(controller.getSnapshot().entries).toHaveLength(2)
    controller.clear()
    expect(controller.getSnapshot().entries).toEqual([])
  })

  it('a foto só muda de identidade quando algo mudou, e returned() zera o contador do título', () => {
    const { env, calls } = makeEnv({ away: true })
    const controller = new NotifyController(env)
    const listener = vi.fn()
    controller.subscribe(listener)
    const first = controller.getSnapshot()
    controller.markAllRead()
    controller.clear()
    expect(controller.getSnapshot()).toBe(first)
    expect(listener).not.toHaveBeenCalled()
    controller.returned()
    expect(calls.badge.at(-1)).toBe(0)
  })
})
