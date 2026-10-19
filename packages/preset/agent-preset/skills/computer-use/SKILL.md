---
name: computer-use
description: Use when a task needs to see or operate the machine through Cua Driver (mcp__cua-driver-mcp__*): control one window or the whole screen, read browser pages, click/type/scroll, or chain steps. Scope narrowly first: bind to a single window unless the whole desktop is genuinely needed.
---

# Computer use — the machine as a surface

Cua Driver tools arrive prefixed `mcp__cua-driver-mcp__`. They act on this
machine in the background: no window is raised, the pointer stays put, and a
**teal frame** appears on the OS exactly where the agent is working — around
one window while acting in it, around the whole screen during whole-desktop
captures. The frame exists only while the agent turn is acting (pausing
thinking or stopping the turn clears it), and it hugs the window live: moving,
resizing, maximizing or minimizing the window moves the frame with it
(minimizing hides it). The frame is drawn by a harness plugin observing tool
execution — you never control it directly. The teal ring on the tool-call card
is only the log record, not the cue.

## Assuming control of one window

1. **Discover** — `list_windows` (live windows: pid, app, title, bounds) or
   `list_apps` (installed/running apps with launch paths).
2. **Bind exactly one window** — `get_window_state({ pid, window_id })` returns
   the UIA tree plus a screenshot of that one window. Narrow with `query`,
   ask for `tree_format: 'elements'` to get `element_token`s.
3. **Act by element** — pass `element_token` to `click`, `type_text`,
   `set_value`, `press_key`, `hotkey`, `scroll`, `drag`. Tokens stay valid
   until the window is re-read. Pixel `x, y` (from that window's screenshot)
   is only for canvas/video/custom-drawn surfaces absent from the tree.
4. **Verify** — `verify_state(pid, window_id, expect)` or a fresh
   `get_window_state` with `since: 'latest'` (only-what-changed).

## Assuming control of the whole screen

Only when one window cannot hold the task:

- `get_desktop_state` captures the full display and frames the whole screen;
  then act with `scope: 'desktop'` and `x, y` read from that capture.

`get_desktop_state` sends the entire screen image to the model — prefer the
window scope whenever it suffices.

## Browsers (Chrome/Edge/Brave)

For pages, `get_browser_state` (bind with `pid` + `window_id`, then snapshot
per tab) plus the typed actions `browser_click`, `browser_type`,
`browser_pointer`, `browser_navigate`, `browser_dialog` on the exact
`target_id` + `tab_id` of one tab. These never move the desktop pointer.

## Chains and escalation

- Default delivery is `background`; escalate to `foreground` only when a tool
  answers `background_unavailable`.
- Fixed action list — `run_steps` (pre-validated, stops at the first failure).
- Logic (loops/branches/retries) — `run_script` (one sandboxed call).