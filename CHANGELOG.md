# Changelog

What changed in each version of the statusbar plugin. To get notified of new versions, **Watch → Custom → Releases** on GitHub.

To update:

```bash
claude plugin marketplace update ian-exnodes
claude plugin update statusbar@ian-exnodes
```

Then `/reload-plugins` in an open session, or start a new `claude`.

## 0.8.2 (2026-10-08)

### Added

- Clean View's working task animates: its mark spins and a bar slides under it.
- Helper agents are listed under the task that was in progress when they started, one row each (`✓ Done`,
  `⠹ Running`, `✗ Failed`; past 5, `+N more`), and that task's bar shows how many have finished
  (`1 of 3 · 33%`). Tasks without agents get the sliding bar and no %, since nothing reports their progress.

### Changed

- The `↳ 3 agents: 2 done, 1 running` line is replaced by those rows. Agents still running keep their rows under a
  task marked done.

### Fixed

- A turn that ends while background agents still run no longer collapses the card to `✓ 1 of 2 done · … still
  running`: the card stays open on the agents' rows with `Waiting for 3 agents · 12s`, and collapses to its done
  line once they all finish.
- Only a prompt you send opens a new card. A background agent reporting back (`<task-notification>`) or sending a
  message (`<agent-message …>`) no longer replaces the card with one of its own; the card of your request carries on.

## 0.8.1 (2026-10-06)

### Added

- Clean View counts Claude's helper agents on the card: `↳ 3 agents: 2 done, 1 running` under the working task
  (failures in red). A card closed while agents still run says `· 1 agent still running`, and it re-opens when they
  report back and Claude carries on.

## 0.8.0 (2026-10-06)

### Added

- **Clean View**, a toggle in the Command picker. It hides Claude's tool calls, results, code changes and in-between
  notes, and shows a live checklist card above the prompt (`Step 2 of 4`, each task Done / Working / Next / Up next)
  with Claude's final answer in the transcript. It stays on across sessions; row 1 shows `◐ Clean`. While on, Claude
  is asked to plan each request as tasks. Turn it off and every hidden row shows again.

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
