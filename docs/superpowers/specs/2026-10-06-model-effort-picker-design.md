# Model and effort in the status bar, with a picker

Version 0.7.0 of the statusbar plugin.

## Goal

See the session's model and reasoning effort at a glance, and change either one from the status bar
without typing `/model` or `/effort`.

## What changes on screen

Row 1 today:

```
[Opus 5.5] 📁 statusbar | 🌿 main +1~2
```

Row 1 after:

```
[Opus 5.5] high ⚙ Command 📁 statusbar | 🌿 main +1~2
```

- `[Opus 5.5]` is colored by model family: Opus `magenta`, Sonnet `blue`, Haiku `green`, Fable `yellow`.
  Any other model (a gateway id) stays `cyan`, as today.
- `high` is the effort level, colored on a scale that rises with cost: `low` gray (`subtle`), `medium`
  `cyan`, `high` `yellow`, `xhigh` orange (`#ff8700`), `max` `red`. Hidden when the effort is not known.
- `⚙` is a button. Clicking it opens or closes the picker. `/statusbar` does the same, in case a click
  under the prompt does not reach the plugin.

Row 2 is unchanged.

## The picker

A bordered box drawn in the band above the prompt (`ui.render` on `AbovePrompt`), not a pane:
the spike showed a pane docks full-height beside the transcript in the fullscreen layout, while the band
stays a few rows tall in every layout.

```
╭───────────────────────────────────────────────────────────╮
│ MODEL   Haiku 4.5  Sonnet 5.5 [Opus 5.5] Fable 5.1      ✕  │
│ EFFORT  Low  Medium [High] Xhigh  Max                      │
╰───────────────────────────────────────────────────────────╯
```

- The current model is filled with the model's color, the current effort with its level's color (the
  same scale as row 1). The border takes the model's color.
- Every option is a `plain` Button; hover inverts it.
- Picking a model sets `/config`'s Model row (`$.config.set({ key: 'model', value: <family alias> })`), which
  switches in milliseconds; when the row refuses (a choice only a dialog may make: the long-conversation
  confirm, Fable's consent), it runs `$.command.run({ command: 'model', args: <model id> })`. Picking an effort runs
  `{ command: 'effort', args: <level> }`. Same as the person typing them, so Claude Code's own checks
  apply. In a long conversation, a model or effort change can show Claude Code's confirm dialog (the
  model re-reads the conversation); cancelling it prints "Kept model as …" and nothing changes. That is
  expected and the picker does not bypass it.
- The picker stays open after a pick, so model and effort can both be set. It closes on `✕` or when the
  person submits a prompt (`prompt.submit` whose origin is not a plugin).
- Esc does not close it (a band cannot; Esc only returns the keys to the prompt).

The model list is fixed in code: Haiku 4.5, Sonnet 5.5, Opus 5.5, Fable 5.1 (`claude-haiku-4-5-20251001`,
`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`). There is no API that lists the models a
session may use; when a new model ships, the list is edited.

## Where the values come from

| Value | Source |
|---|---|
| Model | `$.session.model()`, as today |
| Effort at session start | `$.settings.read().effortLevel` (spike: `CLAUDE_EFFORT` is not set in the plugin's environment) |
| Effort after `/effort` | the `command.run` hook on `{ command: 'effort' }`: after `next(e)`, store `e.args` when it is a level |
| Effort during a turn | the `turn.step` hook: `e.effort`, the level actually sent (after any downgrade for the model) |
| Model after `/model` | the `command.run` hook on `{ command: 'model' }`: after `next(e)`, `refresh` re-reads `$.session.model()` |

Both `command.run` hooks see a change whether the person typed the command or the picker ran it, so the
status bar redraws right after either.

## Code changes

- `types/index.d.ts`: `StatusFigures` gains `effort?: string`; `PluginState['statusbar']` gains
  `effort: string | null` and `isPickerOpen: boolean`.
- `hooks/format.ts`: `modelColor(id)` and `effortColor(level)`; row 1 gains the effort segment. Pure
  functions, so the tests cover them.
- `hooks/register.tsx`:
  - `ui.render` on `PromptHint` draws row 1 from segments and puts a `⚙` Button after the effort.
  - New hooks: `turn.step` (async generator), `command.run` on `model` and on `effort`, `prompt.submit`,
    `ui.render` on `AbovePrompt` (the picker).
- `hooks/format.test.ts`: model colors per family and the fallback, the effort color scale, row 1 with
  and without an effort.
- `README.md`: row 1 table gains the effort and the `⚙`; a short "Picker" section.
- `.claude-plugin/plugin.json`: version `0.7.0`.

## Out of scope

- Esc to close (needs a pane, which docks full-height in fullscreen).
- Hiding effort for models that take none (Haiku 4.5): the effort shown is the session's setting.
- Saving the pick as the default for new sessions: `/model` and `/effort` set this session only.

## Verification

- `claude plugin validate .` and `claude plugin test .` pass.
- In a live session (`claude --plugin-dir .`): the colors per model, the effort shown before the first
  prompt, `⚙` opens the picker, a pick updates row 1 and Claude Code's own `/effort` hint, `✕` and a
  submitted prompt close it.

## Changes after the live check

- The button reads `⚙ Command`.
- The picker is a pane (`$.ui.open` with `closeOnEscape`), not a band: the person wanted Esc to close it, and a band
  never hears Esc. In the fullscreen layout it docks beside the transcript; the person chose that over no Esc.
- A model is set through `/config`'s Model row (`$.config.set`), falling back to `/model` when the row refuses.
- The model is read every second: no event reaches a user-tier plugin when it changes.
- The picker records its own effort pick: a plugin's own `$.command.run` skips its own hooks.
