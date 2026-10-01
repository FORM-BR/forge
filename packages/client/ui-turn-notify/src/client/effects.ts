/** Efeitos de navegador da central de avisos: sinal sonoro, notificação do sistema e título da aba. */
import type { NoticeEntry, NoticeKind, NotifyEnv, SystemPermission } from './controller.ts'

/** Notas (Hz, atraso em s) de cada sinal: "concluído" sobe e resolve; "atenção" insiste em três toques. */
const MELODY: Record<NoticeKind, readonly (readonly [number, number])[]> = {
  done: [[659.25, 0], [880, 0.13]],
  attention: [[880, 0], [880, 0.16], [1174.66, 0.32]],
}

let audio: AudioContext | undefined

/**
 * Toca o sinal do tipo pedido. Navegadores só liberam áudio depois de alguma interação
 * com a página; antes disso a chamada falha em silêncio.
 * @param kind - tipo de aviso.
 */
export function playChime(kind: NoticeKind): void {
  try {
    const scope: { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext } = globalThis
    const Context = scope.AudioContext ?? scope.webkitAudioContext
    if (Context === undefined) return
    audio ??= new Context()
    if (audio.state === 'suspended') void audio.resume()
    const start = audio.currentTime
    for (const [frequency, delay] of MELODY[kind]) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + delay)
      gain.gain.exponentialRampToValueAtTime(0.08, start + delay + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.22)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start(start + delay)
      oscillator.stop(start + delay + 0.25)
    }
  } catch (_error) {
    // Áudio bloqueado ou indisponível: o aviso visual continua valendo.
  }
}

function permission(): SystemPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/**
 * Monta o ambiente real do navegador.
 * @param open - abre uma sessão no app.
 * @returns efeitos de borda para o controlador.
 */
export function browserEnv(open: (sessionId: string) => void): NotifyEnv {
  return {
    now: () => Date.now(),
    storage: (() => {
      try { return globalThis.localStorage } catch (_error) { return undefined /* acesso negado */ }
    })(),
    isAway: () => document.hidden || !document.hasFocus(),
    chime: playChime,
    system(entry: NoticeEntry, body: string) {
      try {
        const notification = new Notification(entry.title, { body, tag: `forge-${entry.sessionId}`, silent: true })
        notification.onclick = () => {
          window.focus()
          open(entry.sessionId)
          notification.close()
        }
      } catch (_error) {
        // Alguns contextos (iframe, WebView) recusam o construtor; o título da aba cobre.
      }
    },
    async requestPermission() {
      if (typeof Notification === 'undefined') return 'unsupported'
      try {
        return await Notification.requestPermission()
      } catch (_error) {
        return permission() // Safari antigo só aceita callback
      }
    },
    permission,
    badge(count: number) {
      // O título pode mudar enquanto o app roda: sempre parte do título atual, sem o prefixo antigo.
      const bare = document.title.replace(/^\(\d+\) /, '')
      document.title = count > 0 ? `(${String(count)}) ${bare}` : bare
    },
    open,
  }
}
