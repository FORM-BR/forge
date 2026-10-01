---
description: "Sino flutuante de avisos do FORGE: sinal sonoro, notificação do sistema e contador no título da aba quando uma sessão termina ou espera o usuário, para quem roda várias sessões em paralelo."
kind: "package"
---

# ui-turn-notify — central de avisos de fim de turno

## Para que serve

Com várias sessões rodando ao mesmo tempo (o FORGE fazendo o básico enquanto você trabalha em outra coisa), é fácil
deixar uma sessão parada esperando aprovação ou já terminada. Este plugin avisa:

- **Concluída** — a sessão parou de rodar sem nenhum pedido pendente.
- **Precisa de você** — apareceu uma aprovação ou pergunta para o usuário.

Cada aviso aciona, conforme as preferências: um sinal sonoro curto (dois tons para "concluída", três toques para
"precisa de você"), uma notificação do sistema (só com a janela em segundo plano) e o contador `(N)` no título da aba.
Os avisos recentes ficam num **sino** no canto inferior direito; clicar num aviso abre a sessão.

## Regras de aviso

- A primeira leitura só define a linha de base: abrir o app nunca dispara aviso de sessões antigas.
- Subagentes não avisam (o pai avisa).
- Com a janela em foco **e** a sessão aberta na tela, não há aviso (preferência "Não avisar quando eu já estou olhando").
- Abrir uma sessão em foco marca os avisos pendentes dela como lidos; fechar o painel marca todos.
- No máximo 30 avisos; os mais novos primeiro.

## Preferências

Guardadas no `localStorage` do navegador (`forge.turnNotify.prefs.v1`): avisos ligados, som, notificação do sistema,
"só quando não estou olhando". Ligar a notificação do sistema pede a permissão do navegador no clique; se estiver
bloqueada, o painel explica como liberar.

## Estrutura

| Arquivo | Papel |
|---|---|
| `src/client/controller.ts` | Detecção de transições, política de aviso, preferências. Puro, sem DOM. |
| `src/client/effects.ts` | Efeitos reais: WebAudio, `Notification`, título da aba. |
| `src/client/TurnNotifyHost.tsx` | Sino, lista e chaves (entrada em `shell.overlay`). |
| `src/client/index.ts` | `apply`: dicionário `turnNotify` (en/zh) e registro do slot. |

Lê `useSessionStatus` (campos `running` e `pendingInteraction`) e `useSessions`; navega com `ctx.uiWorkspace.openSession`.
Não toca no host nem em nenhum outro plugin.

## Limitações conhecidas

- O aviso diz "Turn ended" (fim de turno), não "concluído com sucesso": o cliente não recebe um sinal global de falha por sessão, então um turno que terminou em erro gera o mesmo aviso. Abra a sessão para ver o desfecho.
- Textos só em en/zh (os únicos idiomas que o FORGE carrega hoje).
- As preferências ficam no `localStorage` do navegador, por dispositivo.

## Testes

```sh
pnpm vitest run packages/client/ui-turn-notify
```
