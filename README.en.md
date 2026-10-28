# FORGE

English | [Português (Brasil)](README.md)

![FORGE](docs/assets/forge-logo.png)

**FORGE** is a desktop and terminal AI agent harness built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), with a simplified Windows installer, rewind/fork from any message in the conversation, and an integrated browser and app preview.

![FORGE model settings screen](docs/assets/forge-screenshot.png)

## Download and install (Windows)

1. Download the installer from the [latest release](https://github.com/FORM-BR/forge/releases/latest) (`FORGE-Setup-x.y.z.exe`).
2. Run the installer. Windows SmartScreen may warn "Windows protected your PC" because the installer is **not code-signed** (a paid certificate has not been purchased yet) — click **"More info"**, then **"Run anyway"**.
3. Open **FORGE** from the shortcut created in the Start Menu or on the Desktop.

No Node.js, pnpm, or any other tool needs to be installed — the installer already bundles everything FORGE needs to run.

## Requirements

- Windows 10 or 11 (64-bit).
- An internet connection to talk to the chosen model provider (e.g. DeepSeek, OpenAI, Anthropic) and to check for updates.
- An API key from at least one supported model provider.

## Configure the provider on first launch

The first time FORGE opens, go to **Settings → Models**, pick a provider (e.g. DeepSeek), and paste your API key into the **API key** field. Click **Apply**. You can add more than one provider and switch between them at any time.

## How to update

FORGE automatically checks for new versions and shows an in-app notice when an update is available, with a **"Download and install"** button. You can also manually download the latest version from the [latest release](https://github.com/FORM-BR/forge/releases/latest) and run the installer over the existing installation.

## How to uninstall

Use Windows **Settings → Apps** (or Control Panel → Programs) and uninstall **FORGE** like any other program — the installer registers a standard Windows uninstaller.

## Privacy

FORGE only talks to the network to:

- send your messages to, and receive responses from, **the model provider you chose and configured** (e.g. DeepSeek, OpenAI, Anthropic) — this is inherent to how an AI agent works;
- check whether a newer version of FORGE exists, by querying the GitHub releases page (no personal data is sent in that check).

**Desktop product usage telemetry/analytics ships enabled by default** in the current installer, inherited from the upstream project (see [the product-analytics package documentation](packages/client/product-analytics/README.md) for exactly what is collected — no API keys, prompts, or responses are ever sent). There is currently no visible UI toggle to turn it off; this is a known gap, tracked for a future fix. The Web UI (run from source, without the Desktop app) does not enable this collection.

## For developers

```sh
pnpm install
pnpm run dev:web
```

See [AGENTS.md](AGENTS.md) for repository conventions, and the [original DeepSeek Harness documentation](docs/UPSTREAM-README.md) for the full architecture and commands.

## Credit and license

FORGE is a fork maintained by **FORM Gestão e Tecnologia**, built on top of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the original project by DeepSeek AI. See [NOTICE.md](NOTICE.md) for full credits.

Licensed under [MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
