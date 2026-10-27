---
description: "Brazilian Portuguese language pack for the web GUI: the pt-BR language definition plus one dictionary per registered locale namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-locale-pt

English | [中文](README.zh.md)

## Summary

Adds Brazilian Portuguese to the web GUI language selector and registers a pt-BR dictionary for every locale namespace the shipped client plugins expose. Missing keys fall back to English through the locale runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package activates with the client tree; no configuration. Open Settings → General and select "Português (Brasil)".

## Model Experience

None, as the locale layer registers nothing model-facing.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Translation follows the English key set** — a namespace key added upstream without a pt-BR entry falls back to English until the entry is added here.

### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

**Runtime invariant:** No companion is published. The language definition and every namespace dictionary register as owned effects whose disposal the plugin spec proves; the locale runtime owns selection, fallback lookup, and persistence, with no second copy to diverge.

</details>
