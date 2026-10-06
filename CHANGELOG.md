# Changelog

What changed in each version of the statusbar plugin. To get notified of new versions, **Watch → Custom → Releases** on GitHub.

To update:

```bash
claude plugin marketplace update ian-exnodes
claude plugin update statusbar@ian-exnodes
```

Then `/reload-plugins` in an open session, or start a new `claude`.

## 0.7.2 (2026-10-06)

### Changed

- Row 2 is labeled and shorter: `Context █░░░░ 21% | Limit 5h ███░░ 76% | Limit 7d ████░ 92%`. Each bar is 5 blocks
  of 20% instead of 10 of 10%; the % beside it is still exact.
- The session timer shows minutes, then hours and minutes (`52m`, `3h 19m`), without seconds.

## 0.7.1 (2026-10-06)

### Fixed

- The picker is the small box above the prompt again. In 0.7.0 it opened as a full-height panel beside the
  transcript in the fullscreen layout. It closes on `✕`, the button again, `/statusbar`, or sending a message;
  Esc does not close it.

## 0.7.0 (2026-10-06)

### Added

- **Effort on row 1**, next to the model: `[Opus 5.5] high ⚙ Command`. Colored by cost: low gray, medium cyan,
  high yellow, xhigh orange, max red. Hidden until the session's effort is known.
- **Model and effort picker.** Press `⚙ Command` (or run `/statusbar`) for a small box above the prompt to switch
  model and effort. A model switches at once through `/config`'s Model setting and also becomes your default
  for new sessions, as `/model` does; when Claude Code needs to ask first, it runs `/model` instead. An effort
  runs `/effort` and also becomes that model's default effort, as typing `/effort` does. It closes on `✕`, the button again, or when you send a message.
- The status bar redraws as soon as the model or effort changes, instead of at the next turn.

### Changed

- The model name is colored by family: Opus magenta, Sonnet blue, Haiku green, Fable yellow. Other models
  stay cyan, as before.

## 0.6.0 (2026-10-06)

First public version. Two rows under the prompt: model, folder, git branch and changes; context fill,
5h and 7d quota left, tokens, cost, session time and last-turn growth. Requires Claude Code 2.1.290 or later.
