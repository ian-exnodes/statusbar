# Changelog

What changed in each version of the statusbar plugin. To get notified of new versions, **Watch → Custom → Releases** on GitHub.

To update:

```bash
claude plugin marketplace update ian-exnodes
claude plugin update statusbar@ian-exnodes
```

Then `/reload-plugins` in an open session, or start a new `claude`.

## Unreleased

### Changed

- The context and usage-limit bars are thin and quieter: `━━━╸─` instead of `███░░`, still 5 cells long. A half
  cell (`╸`) shows each 10%, and only the filled part takes the green, yellow or red; the rest is dim.

## 0.9.1 (2026-10-09)

### Added

- MIT license.
- CI: GitHub Actions validates and tests the plugin on each push to `main` and each pull request.

### Changed

- The checklist tool is registered only while Clean View is on, so a session without it carries no extra tool.
  Turned off mid-session, the tool tells Claude its list was not shown instead of claiming it was.

### Fixed

- A note of Claude's that happened to be part of a line of a recent answer could show through Clean View. Hidden
  rows now show only when they fill whole lines of a final answer.
- `/effort` output with "cancel" anywhere in it was read as a cancel.
- Helper agents that had finished could stay `Running` on the Clean View card (`Waiting for 2 agents`) once Claude Code
  stopped listing them. An agent that leaves the list now keeps its last status, and counts as done if it was running.

## 0.9.0 (2026-10-08)

### Added

- The Clean View card says what Claude is doing, in plain words: `Reading files…`, `Running a command…`,
  `Editing register.tsx…`, `Starting helpers…`, `Looking things up…`, `Using figma…`. It labels the working task's
  bar, or stands in for `Working…` when Claude made no checklist.
- The finished card counts the files changed for the request, helper agents' edits included:
  `✓ 3 of 3 done · 2m · 4 files changed`.
- `[ Details ]` on the card shows Claude's hidden rows (tool calls, results, in-between notes) without switching
  Clean View off; `[ Hide details ]` hides them again, and the next request starts hidden.
- A dim trail line above each final answer, `✓ Fix the login bug · 3 of 3 done · 2m · 1 file changed`, so scrolling
  back shows what each request did. Answers from before a resumed session have none.
- Clean View's working task animates: its mark spins and a bar slides under it.
- Helper agents are listed under the task that was in progress when they started, one row each (`✓ Done`,
  `⠹ Running`, `✗ Failed`; past 5, `+N more`), and that task's bar shows how many have finished
  (`1 of 3 · 33%`). Tasks without agents get the sliding bar and no %, since nothing reports their progress.

### Changed

- Claude's checklist tool is in the prompt's tool list from the start, so Claude no longer loads it through
  ToolSearch before its first call.
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
