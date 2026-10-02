---
description: "Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. Authoring is guided to Creator mode."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

English | [中文](README.zh.md)

## Summary

Choose Agent presets and the new-task default in Web, read what each mode does and what it declares. Authoring is guided to Creator mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Settings shows the built-in and custom card groups with default highlighting and card-body selection; a group without presets is omitted, except the custom group, which keeps its Creator entry on screen. Every card offers “View configuration”, which opens the preset's declared plugin list as read-only YAML in the Loader's own dialect (`!!js` conditions included); a failed preset stays readable because its diagnostic points into that YAML. Escape closes only the viewer and returns focus to its card; leaving Settings clears the viewer, and a late read does not reopen it. The page edits nothing: the Creator entry starts a Creator-mode task that authors or overrides a preset as a bundle, offered while the `cordis` preset is on the roster and a conversation flow exists.

Coding Tools in General Settings decide whether a mode can be chosen at all: with them off the new-session picker disappears and the cards refuse selection, while the saved default keeps composing new tasks. Choosing a healthy default also synchronizes the blank session on the current new-task surface. Creator starts a new task using the `cordis` preset.

A Workspace can carry a business profile: an Agent preset bound to its directory. A Workspace's "..." menu lists a "Workspace profile" group, and choosing None or one healthy preset there saves the binding. A badge after the Workspace title names the preset; a preset that has been removed or failed to load shows its id struck through. The next blank session opened in that Workspace starts on the profile's preset, the same way a pick on the new-session chip does. A pick made on the session wins over the profile for that session, a profile changed later reaches a session that is still blank and unpicked, and a profile naming an unusable preset leaves the default in place. The menu rows, the badge, and the profile's application follow the Coding Tools gate. The profile carries everything its preset composes — prompt persona rows, skills, and tools; the model, permission default, and plugin set stay deployment-wide.

Known shipped presets offer mode details and usage examples in a read-only dialog. Its tabs preserve each page's scroll position; closing returns focus to the opening action. Help does not change the new-task default. The default badge replaces the card's group badge, and the preset id appears beside the title. Guide copy and examples belong to this package.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`agentPresets/list` supplies the roster and marks the current default, and `agentPresets/read` one declaration's YAML for the viewer; default changes write the `agent-preset-registry` settings namespace. The picker, blank-session synchronization and read-only session label use recorded preset identities. Connection resets and settings updates refresh the roster. The roster also carries `workspacePresets`, the profile map from Workspace directory path to preset id; it lives in the `workspacePresets` volatile field of the same settings entry, and each change is one path-addressed `settings.mutate` write. The new-session seat resolves a session's Workspace from the Workspace snapshot (accounting first, `cwd` as fallback) and stages the profile like a pick; it remembers, per session, a person's pick and the last profile value applied, so a refusal is not retried. The menu rows and badge fill the `sidebar.workspaces.workspace.menu.item` and `sidebar.workspaces.workspace.badge` seats that the Workspace browser declares.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Scope](../../core/scope/README.md) — Registration isolation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Cordis](../../../docs/cordis-primer.md) — Plugin configuration and lifecycle.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected preset, whose plugins own model-visible capabilities.

#### KV Cache effect

Selection changes affect only later tasks; existing plugins and prompts remain unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A profile selects a preset and nothing else: model, permission default, and installed plugins stay global, so third-party plugins cannot differ per Workspace. It applies where a blank session opens in the Web UI; sessions created by other callers start on the default.
- Web creates and edits no preset: the configuration viewer is read-only, and a bundle installed through Creator mode declares a new preset or overrides a shipped one by row id, replacing its complete child list.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published; the Host registry owns state, and component tests cover client presentation and selection.
