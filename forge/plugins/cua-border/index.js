/**
 * experimental-cua-screen-border (protótipo 16/10/2026, v4)
 *
 * Observa a waterfall `tools/pre-execute` (mesmo hook do auto-review) e, para
 * chamadas de computer use (mcp__cua-driver-mcp__*), acende uma borda teal
 * NO SISTEMA OPERACIONAL:
 *   - get_desktop_state  -> moldura na tela inteira (controle do PC)
 *   - tool com `pid`     -> moldura na janela do processo (controle de janela)
 *
 * v4 (pedidos do Felipe em 16/10):
 *   1. moldura reta, sem cantos arredondados            -> overlay.ps1
 *   2. colada na borda REAL do alvo (inset 0 + DWM)     -> overlay.ps1
 *   3. pulsação leve + rótulo no topo no idioma da UI   -> este arquivo resolve
 *      o rótulo ("FORGE está no controle" etc.) a partir de settings 'locale'
 *      e o overlay.ps1 desenha a pílula.
 *   4. a moldura só roda enquanto o AGENTE estiver agindo: o plugin guarda o
 *      id do agente dono da chamada e fecha a moldura quando essa turn para
 *      (agent/turn-stopping), o agente fica idle (agent/status) ou morre
 *      (agent/disposed). -HoldMs (90s) fica só como rede de segurança.
 *
 * A moldura nunca interfere na decisão: sempre retorna next().
 */
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CUA_PREFIX = 'mcp__cua-driver-mcp__'
// Caminhos resolvidos em relação ao PRÓPRIO plugin (import.meta.url): o plugin
// pode ser carregado de qualquer checkout, sem depender da pasta do staging.
const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))
const OVERLAY = join(MODULE_DIR, 'overlay.ps1')
const LOG = join(MODULE_DIR, 'plugin.log')
const HOLD_MS = 90000

/** Namespace/campo do idioma da UI em settings (packages/client/locale). */
const LOCALE_NS = 'locale'
const LOCALE_FIELD = 'preference'

/** Rótulo do topo, por idioma da UI (fallback: en). */
const LABELS = {
  en: 'FORGE is in control',
  pt: 'FORGE está no controle',
  es: 'FORGE tiene el control',
  zh: 'FORGE 正在控制',
}

function labelForLocale(pref) {
  if (typeof pref === 'string') {
    const p = pref.toLowerCase()
    if (p.startsWith('pt')) return LABELS.pt
    if (p.startsWith('es')) return LABELS.es
    if (p.startsWith('zh')) return LABELS.zh
  }
  return LABELS.en
}

/** Trilha de auditoria do protótipo (arquivo local; nunca quebra a chamada). */
function log(message) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${message}\n`)
  } catch { /* ignora */ }
}

/** Versão do protótipo (aparece no plugin.log para provar o que subiu). */
const VERSION = 'v4.2'

/** Cordis plugin identity. */
export const name = 'experimental-cua-screen-border'

/** Only the tool registry is required to observe pre-execute. */
export const inject = ['tools']

/** Parse a pid/window_id from MCP args (numbers or numeric strings). */
function asInt(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : undefined
}

export async function apply(ctx) {
  let child = undefined
  let current = undefined
  let owner = undefined // id do agente dono da moldura atual
  let settingsHandle = undefined

  log(`plugin carregado (apply) ${VERSION}`)

  // Integração OPCIONAL com settings (fica fora do `inject`): só serve para
  // ler o idioma da UI na hora de acender a moldura. Sem settings disponível,
  // o rótulo cai no padrão en.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsHandle = settingsCtx
  })

  const readLocalePreference = () => {
    try {
      const descs = settingsHandle?.settings?.describe?.()
      const entry = Array.isArray(descs) ? descs.find((d) => d?.ns === LOCALE_NS) : undefined
      const value = entry?.value
      if (value !== null && typeof value === 'object' && typeof value[LOCALE_FIELD] === 'string') {
        return value[LOCALE_FIELD]
      }
      return ''
    } catch {
      return ''
    }
  }

  const stop = () => {
    if (child !== undefined) {
      try { child.kill() } catch { /* ignore */ }
      child = undefined
    }
    current = undefined
    // owner é redefinido no próximo show(); zerar aqui impede que um evento
    // atrasado de uma turn antiga feche a moldura já nova de outra turn.
    owner = undefined
  }

  const show = (target) => {
    const serial = `${target.mode}:${target.pid ?? 0}:${target.windowId ?? 0}`
    if (serial === current && child !== undefined) return
    stop()
    const args = ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', OVERLAY,
      '-Mode', target.mode]
    if (target.pid !== undefined) args.push('-TargetPid', String(target.pid))
    if (target.windowId !== undefined) args.push('-WindowId', String(target.windowId))
    args.push('-HoldMs', String(HOLD_MS))
    const label = labelForLocale(readLocalePreference())
    args.push('-Label', label)
    try {
      const proc = spawn('powershell.exe', args, { stdio: 'ignore', windowsHide: true })
      child = proc
      // Só limpa se ESTE processo ainda for o atual: o exit da moldura antiga
      // não pode zerar a referência da nova (senão a nova fica órfã na tela).
      const clear = () => {
        if (child === proc) {
          child = undefined
          current = undefined
        }
      }
      proc.on('error', clear)
      proc.on('exit', clear)
      current = serial
      owner = target.agentId
      log(`show ${serial} label="${label}" owner=${owner ?? '?'}`)
    } catch {
      child = undefined
      current = undefined
      log('erro ao abrir a moldura')
    }
  }

  // A moldura só vive enquanto o AGENTE DONO estiver agindo: fecha quando a
  // turn dele para (pause/think), ele fica idle ou é descartado.
  const stopForOwner = (reason) => {
    if (owner !== undefined && child !== undefined) {
      log(`parar por ${reason}`)
      stop()
    }
  }

  ctx.on('agent/status', (payload) => {
    try {
      if (payload?.agent?.id === owner && payload?.status !== 'running') {
        stopForOwner(`agent/status=${payload.status}`)
      }
    } catch { /* observador nunca pode quebrar o runtime */ }
  })
  ctx.on('agent/turn-stopping', (payload) => {
    try {
      if (payload?.agent?.id === owner) stopForOwner('agent/turn-stopping')
    } catch { /* idem */ }
  })
  ctx.on('agent/disposed', (payload) => {
    try {
      if (payload?.agent?.id === owner) stopForOwner('agent/disposed')
    } catch { /* idem */ }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const toolName = typeof exec?.name === 'string' ? exec.name : ''
      if (toolName.startsWith(CUA_PREFIX)) {
        const args = (exec?.arguments !== null && typeof exec?.arguments === 'object')
          ? exec.arguments
          : {}
        const agentId = exec?.agent?.id
        if (toolName === `${CUA_PREFIX}get_desktop_state`) {
          show({ mode: 'desktop', agentId })
        } else {
          const pid = asInt(args.pid)
          if (pid !== undefined) {
            show({ mode: 'window', pid, windowId: asInt(args.window_id), agentId })
          }
          // Sem pid (leitura de estado, clipboard etc.): não mexe na moldura
          // atual — derrubá-la aqui mataria a moldura de uma janela ainda ativa.
        }
      }
    } catch { /* observador nunca pode quebrar a chamada */ }
    return next()
  })

  // Limpa a moldura se o plugin for descarregado.
  ctx.effect(() => stop, 'cua-screen-border.cleanup')
  log(`${VERSION} handlers registrados (pre-execute + agent/status + turn-stopping + disposed)`)
}