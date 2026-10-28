# cua-border — moldura teal de "computer use" no SO

Quando o agente usa as ferramentas do Cua Driver (`mcp__cua-driver-mcp__*`),
uma moldura teal aparece no lugar certo da tela: em volta da **janela
controlada** (quando a ação mira um `pid`) ou em volta da **tela inteira**
(captura `get_desktop_state`). Ela acompanha a janela ao vivo (move/resize/
maximize/minimize) e **só fica enquanto o agente está agindo** — pausar o
thinking ou parar o turno fecha a moldura. O ring teal no cartão da chamada é
só o registro no log.

## Arquivos

- `index.js` — plugin Cordis ESM: observa `tools/pre-execute` + o ciclo de
  vida do agente (`agent/status`, `agent/turn-stopping`, `agent/disposed`) e
  dispara o overlay nos escopos `desktop` / `window`. Nunca interfere na
  decisão (sempre retorna `next()`). Caminhos de `overlay.ps1` e `plugin.log`
  são resolvidos relativos ao próprio plugin (`import.meta.url`).
- `overlay.ps1` — janela WPF borderless/topmost/click-through
  (`WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_LAYERED|WS_EX_NOACTIVATE`),
  moldura reta colada na borda real (DWM `DWMWA_EXTENDED_FRAME_BOUNDS`),
  pulsação leve do degradê (1.0 ↔ 0.62, 1500 ms) e etiqueta no topo (idioma da
  UI, fallback en) com placa preta translúcida para contraste.
- `cordis.patch.yml` — exemplo de insert para um perfil.

## Como ligar num perfil

No `cordis.patch.yml` do perfil, o `name` do insert pode apontar direto para o
`index.js` (caminho absoluto; o loader reescreve para `file://` e importa):

```yaml
- insert:
    - id: experimental-cua-screen-border
      name: 'C:/caminho/para/<checkout>/forge/plugins/cua-border/index.js'
      config: {}
```

Validação visual, de geometria e de tracking foi feita manualmente pelo
mantenedor; não há suíte automatizada para o overlay WPF.