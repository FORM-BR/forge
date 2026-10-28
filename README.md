# FORGE

[English](README.en.md) | Português (Brasil)

![FORGE](docs/assets/forge-logo.png)

**FORGE** é um harness de agentes de IA para desktop e terminal, baseado no [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), com instalação simplificada para Windows, retroceder/bifurcar em qualquer mensagem da conversa e prévia integrada do navegador e de apps.

![Tela de configuração de modelos do FORGE](docs/assets/forge-screenshot.png)

## Baixar e instalar (Windows)

1. Baixe o instalador na [página de releases](https://github.com/FORM-BR/forge/releases/latest) (arquivo `FORGE-Setup-x.y.z.exe`).
2. Execute o instalador. O Windows SmartScreen pode avisar "o Windows protegeu o computador" porque o instalador **não tem assinatura de código** (certificado pago, ainda não adquirido) — clique em **"Mais informações"** e depois em **"Executar assim mesmo"**.
3. Abra o **FORGE** pelo atalho criado no Menu Iniciar ou na Área de Trabalho.

Não é preciso instalar Node.js, pnpm nem nenhuma outra ferramenta — o instalador já embute tudo o que o FORGE precisa para rodar.

## Requisitos

- Windows 10 ou 11 (64 bits).
- Conexão à internet para falar com o provedor de modelo escolhido (ex.: DeepSeek, OpenAI, Anthropic) e para checar atualizações.
- Uma chave de API de pelo menos um provedor de modelo suportado.

## Configurar o provedor na primeira abertura

Na primeira vez que o FORGE abrir, vá em **Configurações → Models**, escolha um provedor (ex. DeepSeek) e cole sua chave de API no campo **API key**. Clique em **Apply**. É possível adicionar mais de um provedor e trocar entre eles a qualquer momento.

## Como atualizar

O FORGE verifica novas versões automaticamente e mostra um aviso na interface quando há uma atualização disponível, com o botão **"Baixar e instalar"**. Também é possível baixar manualmente a versão mais recente na [página de releases](https://github.com/FORM-BR/forge/releases/latest) e rodar o instalador por cima da instalação existente.

## Como desinstalar

Use **Configurações → Aplicativos** do Windows (ou o Painel de Controle → Programas) e desinstale **FORGE** normalmente, como qualquer outro programa — o instalador registra um desinstalador padrão do Windows.

## Privacidade

O FORGE só se comunica com a internet para:

- enviar suas mensagens e receber respostas do **provedor de modelo que você escolheu e configurou** (ex.: DeepSeek, OpenAI, Anthropic) — isso é inerente ao funcionamento de um agente de IA;
- checar se existe uma nova versão do FORGE, consultando a página de releases do GitHub (sem enviar nenhum dado pessoal nessa checagem).

**Telemetria/analytics de uso do produto (Desktop) vem ligada por padrão** no instalador atual, herdada do projeto original (consulte [a documentação do pacote product-analytics](packages/client/product-analytics/README.md) para o que é coletado — nenhuma chave de API, prompt ou resposta é enviada). Não há hoje um controle visível na interface para desligar; essa é uma lacuna conhecida, registrada para correção futura. A Web UI (quando rodada a partir do código-fonte, sem o app Desktop) não ativa essa coleta.

## Para desenvolvedores

```sh
pnpm install
pnpm run dev:web
```

Veja o [AGENTS.md](AGENTS.md) para as convenções do repositório e a [documentação original do DeepSeek Harness](docs/UPSTREAM-README.md) para a arquitetura e os comandos completos.

## Crédito e licença

FORGE é um fork mantido pela **FORM Gestão e Tecnologia**, construído sobre o [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), projeto original da DeepSeek AI. Veja [NOTICE.md](NOTICE.md) para os créditos completos.

Licenciado sob [MIT](LICENSE). Terceiros e suas licenças estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
