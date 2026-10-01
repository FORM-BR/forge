/**
 * Central de avisos de fim de turno: toca um sinal, mostra notificação do sistema e marca
 * o título da aba quando uma sessão termina ou passa a esperar o usuário, e guarda os
 * avisos recentes num sino flutuante da camada `shell.overlay`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { NotifyController } from './controller.ts'
import { browserEnv } from './effects.ts'
import { en, zh } from './locales.ts'
import { NS, TurnNotifyHost } from './TurnNotifyHost.tsx'
import type { TurnNotifyFace } from './TurnNotifyHost.tsx'

/** Serviços exigidos: registro de slots, dicionários e navegação de workspace. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/** Id da entrada na camada `shell.overlay`. */
export const UI_TURN_NOTIFY_ID = 'turn-notify.bell'

/**
 * Registra o dicionário e o sino. O controlador nasce com o plugin e some junto com ele.
 * @param ctx - contexto raiz do cliente.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-turn-notify.copy')
  const controller = new NotifyController(browserEnv((sessionId) => {
    ctx.uiWorkspace.openSession(sessionId as Parameters<typeof ctx.uiWorkspace.openSession>[0])
  }))
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: UI_TURN_NOTIFY_ID, locale: NS,
    inject: (): TurnNotifyFace => ({ controller }),
  }, TurnNotifyHost)), 'ui-turn-notify.bell')
}

export { DEFAULT_PREFS, NotifyController, PREFS_KEY } from './controller.ts'
export type { NoticeEntry, NoticeKind, NotifyEnv, Prefs, Snapshot } from './controller.ts'
