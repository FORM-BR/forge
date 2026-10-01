/**
 * Detecção e política dos avisos de fim de turno. Sem React e sem DOM: o que toca
 * em áudio, Notification e título da aba entra por `NotifyEnv`, então tudo aqui
 * é testável com um ambiente falso.
 */

/** Tipo de aviso: o agente terminou, ou está esperando uma decisão do usuário. */
export type NoticeKind = 'done' | 'attention'

/** Estado de permissão das notificações do sistema. */
export type SystemPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** Um aviso registrado na central. */
export interface NoticeEntry {
  readonly id: number
  readonly sessionId: string
  readonly title: string
  readonly kind: NoticeKind
  readonly at: number
  readonly read: boolean
}

/** Preferências do usuário, guardadas no navegador. */
export interface Prefs {
  /** Liga/desliga tudo. */
  readonly enabled: boolean
  /** Toca um sinal sonoro curto. */
  readonly sound: boolean
  /** Mostra notificação do sistema quando a janela está em segundo plano. */
  readonly system: boolean
  /** Não avisa quando o usuário já está olhando para a sessão que terminou. */
  readonly onlyUnseen: boolean
}

export const DEFAULT_PREFS: Prefs = { enabled: true, sound: true, system: false, onlyUnseen: true }

/** Chave do localStorage; o sufixo de versão permite mudar o formato sem migração. */
export const PREFS_KEY = 'forge.turnNotify.prefs.v1'

/** Máximo de avisos guardados na central. */
export const MAX_ENTRIES = 30

/** Parte do status de sessão que este plugin lê. */
export interface StatusLike {
  readonly running: boolean | undefined
  readonly pendingInteraction: unknown
}

/** Parte do resumo de sessão que este plugin lê. */
export interface SessionLike {
  readonly displayTitle: string
  readonly origin?: 'subagent' | undefined
  readonly retainedBy: Readonly<Record<string, number | undefined>>
}

/** Efeitos de borda: tudo o que fala com o navegador. */
export interface NotifyEnv {
  now(): number
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  /** A janela está oculta ou sem foco (o usuário não está olhando). */
  isAway(): boolean
  chime(kind: NoticeKind): void
  system(entry: NoticeEntry, body: string): void
  requestPermission(): Promise<SystemPermission>
  permission(): SystemPermission
  /** Atualiza o contador no título da aba; 0 limpa. */
  badge(count: number): void
  /** Abre a sessão no app. */
  open(sessionId: string): void
}

/** Textos localizados que o controlador precisa para notificações do sistema. */
export interface NoticeLabels {
  readonly done: string
  readonly attention: string
}

/** Foto imutável publicada a cada mudança. */
export interface Snapshot {
  readonly entries: readonly NoticeEntry[]
  readonly unread: number
  readonly prefs: Prefs
  readonly permission: SystemPermission
}

/** Lê as preferências guardadas; qualquer defeito volta ao padrão campo a campo. */
export function loadPrefs(storage: NotifyEnv['storage']): Prefs {
  if (storage === undefined) return DEFAULT_PREFS
  let raw: string | null
  try {
    raw = storage.getItem(PREFS_KEY)
  } catch (_error) {
    // Armazenamento bloqueado (janela privada): segue com o padrão.
    return DEFAULT_PREFS
  }
  if (raw === null) return DEFAULT_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (_error) {
    // JSON corrompido: descarta e volta ao padrão.
    return DEFAULT_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
  const record = parsed as Record<string, unknown>
  const flag = (key: keyof Prefs): boolean => typeof record[key] === 'boolean' ? record[key] : DEFAULT_PREFS[key]
  return { enabled: flag('enabled'), sound: flag('sound'), system: flag('system'), onlyUnseen: flag('onlyUnseen') }
}

/** Resumo mínimo de uma sessão no instante anterior. */
interface Previous {
  readonly running: boolean
  readonly pending: boolean
}

/** Controlador da central de avisos. */
export class NotifyController {
  private prefs: Prefs
  private entries: readonly NoticeEntry[] = []
  private previous: ReadonlyMap<string, Previous> | undefined
  private sequence = 0
  private snapshot: Snapshot
  private readonly listeners = new Set<() => void>()

  constructor(private readonly env: NotifyEnv) {
    this.prefs = loadPrefs(env.storage)
    this.snapshot = this.build()
  }

  /** Assina mudanças; devolve o cancelamento. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Foto atual; a identidade só muda quando algo mudou (exigência do useSyncExternalStore). */
  readonly getSnapshot = (): Snapshot => this.snapshot

  /**
   * Compara o status atual com o anterior e registra os avisos novos.
   * @param statuses - status de UI por sessão.
   * @param sessions - resumos de sessão (título, origem, qual está aberta).
   * @param labels - textos para a notificação do sistema.
   */
  observe(
    statuses: ReadonlyMap<string, StatusLike>,
    sessions: Readonly<Record<string, SessionLike | undefined>>,
    labels: NoticeLabels,
  ): void {
    const previous = this.previous
    const next = new Map<string, Previous>()
    for (const [id, status] of statuses) {
      if (status.running === undefined) continue
      next.set(id, { running: status.running, pending: status.pendingInteraction !== undefined })
    }
    this.previous = next

    let changed = this.markSeenAsRead(sessions)
    if (previous !== undefined) {
      for (const [id, now] of next) {
        const before = previous.get(id)
        if (before === undefined) continue
        const kind = transition(before, now)
        if (kind === undefined) continue
        const session = sessions[id]
        if (session?.origin === 'subagent') continue
        if (this.alert(id, session, kind, labels)) changed = true
      }
    }
    if (changed) this.publish()
  }

  /** Muda uma preferência; ligar `system` pede a permissão (precisa de gesto do usuário). */
  async setPref(key: keyof Prefs, value: boolean): Promise<void> {
    if (key === 'system' && value) {
      const permission = this.env.permission() === 'granted' ? 'granted' : await this.env.requestPermission()
      if (permission !== 'granted') {
        this.publish()
        return
      }
    }
    this.prefs = { ...this.prefs, [key]: value }
    try {
      this.env.storage?.setItem(PREFS_KEY, JSON.stringify(this.prefs))
    } catch (_error) {
      // Sem armazenamento a preferência vale só nesta sessão do navegador.
    }
    this.publish()
  }

  /** Marca todos os avisos como lidos. */
  markAllRead(): void {
    if (this.entries.every(entry => entry.read)) return
    this.entries = this.entries.map(entry => entry.read ? entry : { ...entry, read: true })
    this.publish()
  }

  /** Esvazia a central. */
  clear(): void {
    if (this.entries.length === 0) return
    this.entries = []
    this.publish()
  }

  /** Abre a sessão de um aviso e o marca (e aos da mesma sessão) como lido. */
  openEntry(id: number): void {
    const entry = this.entries.find(candidate => candidate.id === id)
    if (entry === undefined) return
    this.entries = this.entries.map((candidate) => {
      return candidate.sessionId === entry.sessionId && !candidate.read ? { ...candidate, read: true } : candidate
    })
    this.publish()
    this.env.open(entry.sessionId)
  }

  /** O usuário voltou para a janela: o contador do título deixa de valer. */
  returned(): void {
    this.env.badge(0)
  }

  private alert(sessionId: string, session: SessionLike | undefined, kind: NoticeKind, labels: NoticeLabels): boolean {
    if (!this.prefs.enabled) return false
    const away = this.env.isAway()
    const looking = !away && (session?.retainedBy.mainView ?? 0) > 0
    if (this.prefs.onlyUnseen && looking) return false
    const entry: NoticeEntry = {
      id: ++this.sequence,
      sessionId,
      title: session?.displayTitle ?? sessionId,
      kind,
      at: this.env.now(),
      read: false,
    }
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES)
    if (this.prefs.sound) this.env.chime(kind)
    if (away && this.prefs.system && this.env.permission() === 'granted') this.env.system(entry, labels[kind])
    if (away) this.env.badge(this.unread())
    return true
  }

  /** Quem já está olhando para a sessão não precisa de aviso pendente dela. */
  private markSeenAsRead(sessions: Readonly<Record<string, SessionLike | undefined>>): boolean {
    if (this.env.isAway()) return false
    let changed = false
    this.entries = this.entries.map((entry) => {
      if (entry.read || (sessions[entry.sessionId]?.retainedBy.mainView ?? 0) === 0) return entry
      changed = true
      return { ...entry, read: true }
    })
    return changed
  }

  private unread(): number {
    return this.entries.filter(entry => !entry.read).length
  }

  private build(): Snapshot {
    return { entries: this.entries, unread: this.unread(), prefs: this.prefs, permission: this.env.permission() }
  }

  private publish(): void {
    this.snapshot = this.build()
    for (const listener of [...this.listeners]) listener()
  }
}

/** A sessão parou de rodar sem pedir nada (concluiu) ou passou a esperar o usuário (atenção). */
function transition(before: Previous, now: Previous): NoticeKind | undefined {
  if (!before.pending && now.pending) return 'attention'
  if (before.running && !now.running && !now.pending) return 'done'
  return undefined
}
