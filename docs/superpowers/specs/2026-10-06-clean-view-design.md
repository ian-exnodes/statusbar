# Clean View

Version 0.8.0 of the statusbar plugin.

## Goal

Some people want to follow Claude's progress and outcome, not its mechanics. Clean View is a mode, switched in the
Command picker, that hides what Claude does along the way (tool calls, their results, code changes, progress lines and
its in-between notes) and shows a live checklist of Claude's tasks instead. The final answer still appears in the
transcript.

Nothing is removed: the hidden content is only not drawn. Turning Clean View off shows all of it again.

## What the person sees

### The toggle

The Command picker (`[ ⚙ Command ]` or `/statusbar`) gets a third row:

```
MODEL       Haiku 4.5  Sonnet 5.5 [Opus 5.5] Fable 5.1   ✕
EFFORT      Low  Medium [High] Xhigh  Max
CLEAN VIEW  [Off]  On
```

The choice is kept across sessions (the plugin's own store, `$.store`, key `cleanView`), so it stays on until turned
off. While it is on, row 1 shows `◐ Clean` after the Command button:

```
[Opus 5.5] high [ ⚙ Command ] ◐ Clean | 📁 statusbar | 🌿 main
```

### While Claude works

The transcript shows the person's request, then nothing until the final answer. A card above the prompt carries the
progress:

```
╭──────────────────────────────────────────────────╮
│ ✧ Build a weather dashboard for New York…        │
│ Step 2 of 4  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░                │
│ ✓ Pick the page style and layout        Done     │
│ ● Check how the page gets live weather  Working  │
│ ○ Build the weather dashboard           Next     │
│ ○ Publish it and share the link         Up next  │
╰──────────────────────────────────────────────────╯
```

- **Title**: the request's text, first line, cut to 48 characters with `…`.
- **Step N of M**: M is the number of tasks; N is the position of the first task in progress, or the number done when
  none is in progress (all done: M of M).
- **Bar**: 20 cells, filled in proportion to tasks done.
- **Rows**, in creation order:

  | Status | Mark | Label | Color |
  |---|---|---|---|
  | completed | `✓` | Done | green |
  | in progress | `●` | Working | the model's color (as row 1), bold |
  | the first pending task after the working one (or the first pending, when none works) | `○` | Next | dim |
  | any other pending task | `○` | Up next | dim |

- **Border**: round, in the model's color.

### When Claude finishes

The final answer appears in the transcript. The card stays, closed out, until the next request:

```
│ ✧ Build a weather dashboard for New York…        │
│ ✓ 4 of 4 done · 3m                               │
```

The time uses the status bar's format (`3m`, `3h 19m`), or seconds under a minute (`45s`).

### Never hidden

Permission prompts, Claude's questions to the person (AskUserQuestion), Claude Code's own notices (errors, interrupts),
command output, and anything the person types. These are drawn by components Clean View does not touch.

## Where the tasks come from

While Clean View is on, a `prompt.compose` hook adds one section to Claude's system prompt (scope `session`):

> The person is using Clean View: they see a checklist of your tasks, not your tool calls. Before working on a request,
> break it into a few short tasks with TaskCreate (subject: a plain-language step, under 50 characters). Mark each task
> in_progress when you start it and completed when it is done. For a quick question, one task is enough.

The card is built from Claude's task calls, read in `tool.call` hooks after `next(e)`:

- `TaskCreate`: adds a task (`subject`, status `pending`) under the id the result returns.
- `TaskUpdate`: changes `status` and/or `subject` of the task with that id; `deleted` removes it.
- `TodoWrite`: replaces the whole list with its `todos` (`content` as subject, `status`).

Calls from a subagent (`agentId` set) are ignored.

## How it is built

### Files

- `hooks/clean.ts`: pure logic, unit-tested. The checklist reducer (one function per task call), the card model
  (title, step, bar, rows with mark, label and color), the done line, and `isFinalAnswer(text, finals)`.
- `hooks/clean.test.ts`: its tests.
- `hooks/clean-view.tsx`: a second hooks module, listed in `hooks/hooks.json` after `register.tsx`.
- `types/index.d.ts`: state for Clean View under the `statusbar` plugin name.
- `hooks/register.tsx`: the picker's `CLEAN VIEW` row; the AbovePrompt hook passes `next(e)`'s tree through when the
  picker is closed, so the card (drawn by the other module) shows.
- `hooks/format.ts`: the `◐ Clean` segment on row 1.

### State

| Key | Holds | Where |
|---|---|---|
| `cleanView` | on or off | `$.store` (kept across sessions), mirrored into `$.state` `statusbar.cleanView` for drawing |
| `statusbar.checklist` | `{ title, tasks: { id, subject, status }[], startedAt, endedAt?, outcome? }` or null | `$.state` |
| `statusbar.finals` | the final answer texts of this session's completed turns (last 50) | `$.state` |

### Hooks in `clean-view.tsx`

| Event | Does |
|---|---|
| `session.start` | reads `cleanView` from `$.store` into state |
| `turn.start` | when on: a fresh checklist titled from `e.text`, `startedAt` now |
| `tool.call` on `TaskCreate`, `TaskUpdate`, `TodoWrite` | after `next(e)`, when on and not a subagent: updates the checklist |
| `turn.complete` | adds the result's `text` to `finals`; sets `endedAt` and `outcome` (`answer`, else `stopped`) |
| `prompt.compose` | when on: adds the Clean View section |
| `ui.render` on `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress` | when on: draws nothing |
| `ui.render` on `AssistantMessage` | when on: draws the row only if `e.props.text` is in `finals`; else nothing |
| `ui.render` on `AbovePrompt` | when on and a checklist exists: the card above `next(e)`'s tree |

Every hook passes straight through to `next(e)` when Clean View is off.

### Data flow

```
request ──► turn.start ──► checklist: title, no tasks
Claude: TaskCreate / TaskUpdate / TodoWrite ──► tool.call ──► checklist updates, card redraws
Claude: final reply ──► turn.complete ──► text into finals ──► that message draws; card closes out
any other Claude row ──► ui.render ──► nothing (while on)
```

## Edge cases

| Case | Behavior |
|---|---|
| Claude makes no tasks | The card shows the title and `Working… <time>`; the final answer appears as usual |
| The person presses Esc mid-turn | The card: `Stopped · N of M done`; the partial text stays hidden (not a final answer) |
| The turn ends in an error or a refusal | The card: `Stopped`; Claude Code's own notice is not hidden |
| Permission prompt, AskUserQuestion | Shown: different components |
| A subagent's tasks | Ignored |
| Two final answers with the same text | Both shown (harmless) |
| Clean View switched on mid-turn | Rows hide from then on; the card starts with the next request |
| Clean View off | Every Clean View hook passes through; behavior is 0.7.2's |

## Out of scope

- A card per request kept in the transcript history (the card lives above the prompt and resets each request).
- A summary written by the plugin: Claude's final answer is the summary.
- Hiding the person's own messages or Claude Code's notices.

## Open question for the plan's first task

Whether a `ui.render` hook may draw nothing for a transcript row by returning `null`, or must return an empty `Box`.
The plan starts with a throwaway probe that settles it.

## Testing

- `hooks/clean.test.ts`: the reducer for each task call (create, update status, rename, delete, TodoWrite replace,
  unknown id ignored); the card at each stage (no tasks, none started, one working, all done, stopped); title
  shortening; `isFinalAnswer`.
- `claude plugin validate .` and `claude plugin test .`; `tsc`.
- A scripted interactive run with Clean View on: one request; tool rows hidden, card filled, final answer shown.
- The person's live check.

## Release

0.8.0: README section, CHANGELOG entry, GitHub release; branch, PR, merge.

## Changes during implementation

- One hooks module per plugin, and `$` is followed only within one file: Clean View's engine code lives in
  `hooks/register.tsx`; the pure logic stays in `hooks/clean.ts`; there is no `clean-view.tsx`.
- A transcript row is hidden by drawing an empty `Box`; a `ui.render` hook returning `null` fails.
- `prompt.compose` is bypassed for user-tier plugins (cc-plugin-sec-default), so the planning instruction rides with
  each of the person's prompts as `prompt.submit` `context`, which only Claude reads.
- Claude Code's task tools are present in some sessions and absent in others (`ToolSearch: none found: TaskCreate`),
  so the plugin registers its own tool, `mcp__statusbar__checklist` (the whole list each call), and the note asks
  Claude to use it, loading it through ToolSearch if it is deferred. The TaskCreate / TaskUpdate / TodoWrite hooks
  stay for sessions that have them.
