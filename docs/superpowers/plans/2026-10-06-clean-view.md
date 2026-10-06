# Clean View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Clean View mode, toggled in the Command picker, that hides Claude's tool rows and in-between notes and shows a live checklist card above the prompt, with Claude's final answer still in the transcript.

**Architecture:** Pure checklist and card logic in `hooks/clean.ts` (unit-tested). A second hooks module, `hooks/clean-view.tsx`, builds the checklist from Claude's task tool calls, remembers each turn's final answer, asks Claude to plan through `prompt.compose`, hides transcript rows through `ui.render`, and draws the card in the band above the prompt. `hooks/register.tsx` gains the picker's `CLEAN VIEW` row and stacks the picker over the card; `hooks/format.ts` adds `◐ Clean` to row 1.

**Tech Stack:** Claude Code plugin function hooks (TSX against `claude-code`), `claude plugin validate`, `claude plugin test` (`claude-code/testing`), `tsc`.

**Spec:** `docs/superpowers/specs/2026-10-06-clean-view-design.md`

## Global Constraints

- Claude Code 2.1.290 or later; no new dependencies.
- Work on branch `feat/clean-view`; `main` is protected and the local branch-guard hook refuses edits on it. Conventional commits, no Co-Authored-By trailer.
- The repo is public: no local paths (`/Users/…`, `/private/tmp/…`) in tracked files.
- Clean View is kept across sessions in `$.store` key `cleanView`; mirrored into `$.state` `statusbar.cleanView`.
- Hidden while on: `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress`, and every `AssistantMessage` that is not a remembered final answer. Never touched: permission prompts, `AskUserQuestion`, `InfoNotice`, `CommandOutput`, `UserMessage`, `Spinner`.
- Card: title = request's first line, at most 48 characters, cut at a word boundary with `…`; `Step N of M` (N = position of the first in-progress task, else the number done); 20-cell bar filled by tasks done; rows `✓ Done` green, `● Working` model color bold, `○ Next` dim (first pending after the working task, else the first pending), `○ Up next` dim; round border in the model color.
- Closed-out card: `✓ N of M done · <time>` (answer), `Stopped · N of M done · <time>` (otherwise); with no tasks `✓ Done · <time>` / `Stopped · <time>`; while working with no tasks `Working… <time>`. Time: `45s` under a minute, `3m`, `3h 19m`.
- The `prompt.compose` section text, verbatim: "The person is using Clean View: they see a checklist of your tasks, not your tool calls. Before working on a request, break it into a few short tasks with TaskCreate (subject: a plain-language step, under 50 characters). Mark each task in_progress when you start it and completed when it is done. For a quick question, one task is enough."
- Subagent task calls (`agentId` set) are ignored.
- Every Clean View hook passes straight through to `next(e)` while Clean View is off.
- Release as 0.8.0.

## Review Focus

- `TaskUpdate` naming an id the card never saw (a task created before Clean View was switched on): ignored, no crash, no phantom row.
- A final answer drawn in several `AssistantMessage` blocks, or with parts the terminal hides: each block of it still shows (matched as a part of the final answer, not by equality).
- The picker open while a card is showing: both draw, picker above the card.
- `TodoWrite` used instead of `TaskCreate`: the card shows its list, replaced wholesale on each write.
- Clean View switched on with no turn yet: no card, no error; row 1 shows `◐ Clean`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `types/index.d.ts` | State contract | `CleanTaskStatus`, `CleanTask`, `CleanChecklist`; `StatusFigures.isClean?`; state keys `cleanView`, `checklist`, `finals` |
| `hooks/clean.ts` | Pure checklist and card logic | Create |
| `hooks/clean.test.ts` | Its tests | Create |
| `hooks/clean-view.tsx` | Clean View hooks module | Create |
| `hooks/hooks.json` | Module list | Add `./clean-view.tsx` |
| `hooks/format.ts`, `hooks/format.test.ts` | Row 1 | `◐ Clean` segment |
| `hooks/register.tsx` | Picker | `CLEAN VIEW` row; picker stacked over `next(e)` |
| `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` | Docs, version | 0.8.0 |

---

### Task 1: Probe — can a `ui.render` hook draw nothing?

Throwaway. Settles the spec's open question: whether a hook hides a transcript row by returning `null`, or must return an empty `Box`.

**Files:**
- Create (git-ignored, deleted at the end of the task): `.superpowers/sdd/probe-hide/.claude-plugin/plugin.json`, `.superpowers/sdd/probe-hide/hooks/hooks.json`, `.superpowers/sdd/probe-hide/hooks/register.tsx`

**Interfaces:**
- Produces: a ledger ruling `HIDDEN = null` or `HIDDEN = empty Box`, used by Task 3.

- [ ] **Step 1: Write the probe plugin**

```bash
P=~/statusbar/.superpowers/sdd/probe-hide; mkdir -p $P/.claude-plugin $P/hooks
echo '{ "name": "probehide", "version": "0.0.1", "description": "THROWAWAY: can ui.render draw nothing" }' > $P/.claude-plugin/plugin.json
echo '{ "modules": ["./register.tsx"] }' > $P/hooks/hooks.json
cat > $P/hooks/register.tsx <<'EOF'
// THROWAWAY probe: hide every tool row by returning null
import type { Register } from 'claude-code'
export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async () => null)
  on('ui.render', { component: 'AssistantMessage' }, async () => null)
}
EOF
claude plugin validate $P
```

Expected: `✔ Validation passed`, or an error naming the return type. If it errors, change both hooks to
`async ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> }` and validate again.

- [ ] **Step 2: Run it interactively with one tool call**

```bash
cd ~/statusbar && python3 - "$HOME/statusbar/.superpowers/sdd/probe-hide" <<'EOF'
import os, pty, time, select, sys
def drain(fd, secs):
    end=time.time()+secs; out=b''
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.2)
        if r:
            try: out+=os.read(fd,65536)
            except OSError: break
    return out
pid, fd = pty.fork()
if pid == 0:
    os.environ['COLUMNS']='170'; os.environ['LINES']='50'
    os.execvp('claude', ['claude','--plugin-dir',sys.argv[1],'--debug'])
drain(fd, 12)
for ch in 'Run this shell command and nothing else: echo probe-hide-marker': os.write(fd, ch.encode()); time.sleep(0.02)
time.sleep(0.8); os.write(fd, b'\r'); out=drain(fd, 40)
print('marker drawn:', b'probe-hide-marker' in out.replace(b'\x1b', b''))
for ch in '/exit': os.write(fd, ch.encode()); time.sleep(0.03)
time.sleep(0.5); os.write(fd, b'\r'); drain(fd, 3)
try: os.kill(pid, 9)
except Exception: pass
EOF
f=$(ls -t ~/.claude/debug/*.txt | head -1); grep -n -E 'probehide|ui.render \((ToolUse|AssistantMessage)\)' "$f" | cut -c1-220 | tail -8
```

Expected: no `refused` line for `probehide`; the debug log shows the `ui.render` hooks settling. (The marker can still appear on screen as the typed prompt; the log is the evidence.)

- [ ] **Step 3: Record the ruling and delete the probe**

```bash
rm -rf ~/statusbar/.superpowers/sdd/probe-hide
```

Ledger line: `Task 1: Ruling: HIDDEN = null` when Step 2 showed no refusal for `null`; otherwise `Task 1: Ruling: HIDDEN = empty Box`. Nothing to commit.

---

### Task 2: Checklist and card logic (`clean.ts`)

**Files:**
- Modify: `types/index.d.ts`
- Create: `hooks/clean.ts`
- Test: `hooks/clean.test.ts`

**Interfaces:**
- Produces (in `types/index.d.ts`):
  - `type CleanTaskStatus = 'pending' | 'in_progress' | 'completed'`
  - `type CleanTask = { id: string; subject: string; status: CleanTaskStatus }`
  - `type CleanChecklist = { title: string; tasks: CleanTask[]; startedAt: number; endedAt?: number; outcome?: 'answer' | 'stopped' }`
  - `StatusFigures.isClean?: boolean`
  - `PluginState['statusbar']` gains `cleanView: boolean`, `checklist: CleanChecklist | null`, `finals: string[]`
- Produces (in `hooks/clean.ts`):
  - `BAR_CELLS = 20`, `TITLE_MAX = 48`
  - `shortTitle(request: string): string`
  - `startChecklist(request: string, now: number): CleanChecklist`
  - `taskCreated(c: CleanChecklist, id: string, subject: string): CleanChecklist`
  - `taskUpdated(c: CleanChecklist, change: { taskId: string; subject?: string; status?: CleanTaskStatus | 'deleted' }): CleanChecklist`
  - `todosWritten(c: CleanChecklist, todos: readonly { content: string; status: CleanTaskStatus }[]): CleanChecklist`
  - `turnEnded(c: CleanChecklist, now: number, outcome: 'answer' | 'stopped'): CleanChecklist`
  - `elapsed(ms: number): string`
  - `type CardRow = { mark: string; subject: string; label: string; color?: string; isBold?: true; isDim?: true }`
  - `type Card = { title: string; step?: string; filled: number; rows: CardRow[]; footer?: string }`
  - `card(c: CleanChecklist, now: number, accent: string): Card`
  - `isFinalAnswer(text: string, finals: readonly string[]): boolean`
  - `addFinal(finals: readonly string[], answer: string): string[]` (keeps the last 50)

- [ ] **Step 1: Extend the types contract**

In `types/index.d.ts`, add after the `StatusEffort` line:

```ts
/** A task on the Clean View card, as Claude's task tools report it. */
export type CleanTaskStatus = 'pending' | 'in_progress' | 'completed'
export type CleanTask = { id: string; subject: string; status: CleanTaskStatus }

/** The Clean View card for the current request. */
export type CleanChecklist = {
  title: string
  tasks: CleanTask[]
  startedAt: number
  /** Set when the turn completes. */
  endedAt?: number
  outcome?: 'answer' | 'stopped'
}
```

In `StatusFigures`, add after `effort?: StatusEffort`:

```ts
  /** Clean View is on: row 1 shows ◐ Clean. */
  isClean?: boolean
```

In `PluginState['statusbar']`, add after `isPickerOpen: boolean`:

```ts
      cleanView: boolean
      checklist: CleanChecklist | null
      finals: string[]
```

- [ ] **Step 2: Write the failing tests**

Create `hooks/clean.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import {
  addFinal, card, elapsed, isFinalAnswer, shortTitle, startChecklist, taskCreated, taskUpdated, todosWritten, turnEnded,
} from './clean'

const start = startChecklist('Build a weather dashboard for New York with live data and a shareable link', 0)
const four = ['Pick the page style and layout', 'Check how the page gets live weather', 'Build the weather dashboard',
  'Publish it and share the link'].reduce((c, s, i) => taskCreated(c, `t${i}`, s), start)

describe('clean view', () => {
  test('the title is the first line of the request, cut to 48 characters', async () => {
    expect(shortTitle('Fix the login bug\nand more details')).toBe('Fix the login bug')
    expect(start.title).toBe('Build a weather dashboard for New York with…')
    expect(start.title.length <= 48).toBe(true)
  })

  test('task calls build the list: create, status, rename, delete, unknown id', async () => {
    expect(four.tasks.map(t => t.status)).toEqual(['pending', 'pending', 'pending', 'pending'])
    const c = taskUpdated(taskUpdated(four, { taskId: 't0', status: 'completed' }), { taskId: 't1', status: 'in_progress', subject: 'Check live weather' })
    expect(c.tasks[0]?.status).toBe('completed')
    expect(c.tasks[1]).toEqual({ id: 't1', subject: 'Check live weather', status: 'in_progress' })
    expect(taskUpdated(c, { taskId: 't3', status: 'deleted' }).tasks.length).toBe(3)
    expect(taskUpdated(c, { taskId: 'never-seen', status: 'completed' })).toEqual(c)
  })

  test('TodoWrite replaces the whole list', async () => {
    const c = todosWritten(four, [{ content: 'Only step', status: 'in_progress' }])
    expect(c.tasks).toEqual([{ id: 'todo-0', subject: 'Only step', status: 'in_progress' }])
  })

  test('the card while working: step, bar, labels and colors', async () => {
    const c = taskUpdated(taskUpdated(four, { taskId: 't0', status: 'completed' }), { taskId: 't1', status: 'in_progress' })
    const k = card(c, 60_000, 'magenta')
    expect(k.step).toBe('Step 2 of 4')
    expect(k.filled).toBe(5)
    expect(k.rows.map(r => `${r.mark} ${r.label}`)).toEqual(['✓ Done', '● Working', '○ Next', '○ Up next'])
    expect(k.rows[0]?.color).toBe('green')
    expect(k.rows[1]?.color).toBe('magenta')
    expect(k.rows[1]?.isBold).toBe(true)
    expect(k.rows[2]?.isDim).toBe(true)
    expect(k.footer).toBeUndefined()
  })

  test('nothing started yet: the first pending task is Next', async () => {
    const k = card(four, 1_000, 'blue')
    expect(k.step).toBe('Step 0 of 4')
    expect(k.rows.map(r => r.label)).toEqual(['Next', 'Up next', 'Up next', 'Up next'])
  })

  test('no tasks yet: Working with the time', async () => {
    const k = card(start, 45_000, 'blue')
    expect(k.rows).toEqual([])
    expect(k.footer).toBe('Working… 45s')
  })

  test('closed out: done or stopped, with counts when there are tasks', async () => {
    const all = four.tasks.reduce((c, t) => taskUpdated(c, { taskId: t.id, status: 'completed' }), four)
    const closed = card(turnEnded(all, 192_000, 'answer'), 999_999, 'blue')
    expect(closed.rows).toEqual([])
    expect(closed.footer).toBe('✓ 4 of 4 done · 3m')
    const half = taskUpdated(four, { taskId: 't0', status: 'completed' })
    expect(card(turnEnded(half, 30_000, 'stopped'), 0, 'blue').footer).toBe('Stopped · 1 of 4 done · 30s')
    expect(card(turnEnded(start, 5_000, 'answer'), 0, 'blue').footer).toBe('✓ Done · 5s')
    expect(card(turnEnded(start, 5_000, 'stopped'), 0, 'blue').footer).toBe('Stopped · 5s')
  })

  test('time reads 45s, 3m, 3h 19m', async () => {
    expect(elapsed(45_900)).toBe('45s')
    expect(elapsed(192_000)).toBe('3m')
    expect(elapsed(3 * 3_600_000 + 19 * 60_000)).toBe('3h 19m')
  })

  test('a final answer shows, block by block; other notes do not', async () => {
    const finals = addFinal([], 'Done. The dashboard is at /weather.\n\nIt refreshes every 10 minutes.')
    expect(isFinalAnswer('Done. The dashboard is at /weather.', finals)).toBe(true)
    expect(isFinalAnswer('It refreshes every 10 minutes.', finals)).toBe(true)
    expect(isFinalAnswer('Let me check the weather API first.', finals)).toBe(false)
    expect(isFinalAnswer('   ', finals)).toBe(false)
  })

  test('only the last 50 final answers are kept', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `answer ${i}`).reduce(addFinal, [] as string[])
    expect(many.length).toBe(50)
    expect(many[0]).toBe('answer 10')
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `claude plugin test .`
Expected: FAIL, `hooks/clean.test.ts` does not load: `Cannot find module './clean'` (or an export not found).

- [ ] **Step 4: Implement `hooks/clean.ts`**

```ts
import type { CleanChecklist, CleanTaskStatus } from '../types'

export const BAR_CELLS = 20
export const TITLE_MAX = 48
const FINALS_KEPT = 50

// Cut at a word boundary when one is near, so the … does not split a word
export const shortTitle = (request: string) => {
  const line = request.trim().split('\n')[0]?.trim() ?? ''
  if (line.length <= TITLE_MAX) return line
  const cut = line.slice(0, TITLE_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export const startChecklist = (request: string, now: number): CleanChecklist =>
  ({ title: shortTitle(request), tasks: [], startedAt: now })

export const taskCreated = (c: CleanChecklist, id: string, subject: string): CleanChecklist =>
  ({ ...c, tasks: [...c.tasks, { id, subject, status: 'pending' }] })

// An id the card never saw (made before Clean View was on) changes nothing
export const taskUpdated = (
  c: CleanChecklist,
  change: { taskId: string; subject?: string; status?: CleanTaskStatus | 'deleted' },
): CleanChecklist => {
  if (change.status === 'deleted') return { ...c, tasks: c.tasks.filter(t => t.id !== change.taskId) }
  if (!c.tasks.some(t => t.id === change.taskId)) return c
  const { subject, status } = change
  return {
    ...c,
    tasks: c.tasks.map(t => t.id !== change.taskId ? t : { ...t, ...(subject ? { subject } : {}), ...(status ? { status } : {}) }),
  }
}

// TodoWrite sends the whole list each time
export const todosWritten = (c: CleanChecklist, todos: readonly { content: string; status: CleanTaskStatus }[]): CleanChecklist =>
  ({ ...c, tasks: todos.map((t, i) => ({ id: `todo-${i}`, subject: t.content, status: t.status })) })

export const turnEnded = (c: CleanChecklist, now: number, outcome: 'answer' | 'stopped'): CleanChecklist =>
  ({ ...c, endedAt: now, outcome })

export const elapsed = (ms: number) => {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export type CardRow = { mark: string; subject: string; label: string; color?: string; isBold?: true; isDim?: true }
export type Card = { title: string; step?: string; filled: number; rows: CardRow[]; footer?: string }

export const card = (c: CleanChecklist, now: number, accent: string): Card => {
  const total = c.tasks.length
  const done = c.tasks.filter(t => t.status === 'completed').length
  const time = elapsed((c.endedAt ?? now) - c.startedAt)
  const counts = total ? `${done} of ${total} done · ` : ''

  if (c.endedAt !== undefined) {
    const footer = c.outcome === 'answer' ? `✓ ${counts || 'Done · '}${time}` : `Stopped · ${counts}${time}`
    return { title: c.title, filled: 0, rows: [], footer }
  }
  if (total === 0) return { title: c.title, filled: 0, rows: [], footer: `Working… ${time}` }

  const working = c.tasks.findIndex(t => t.status === 'in_progress')
  const next = c.tasks.findIndex((t, i) => t.status === 'pending' && i > working)
  const rows = c.tasks.map((t, i): CardRow =>
    t.status === 'completed' ? { mark: '✓', subject: t.subject, label: 'Done', color: 'green' }
      : t.status === 'in_progress' ? { mark: '●', subject: t.subject, label: 'Working', color: accent, isBold: true }
        : { mark: '○', subject: t.subject, label: i === next ? 'Next' : 'Up next', isDim: true })

  return {
    title: c.title,
    step: `Step ${working >= 0 ? working + 1 : done} of ${total}`,
    filled: Math.round((done / total) * BAR_CELLS),
    rows,
  }
}

// A block of a final answer, not only the whole: the terminal draws a reply in blocks and hides some parts
export const isFinalAnswer = (text: string, finals: readonly string[]) => {
  const block = text.trim()
  return block.length > 0 && finals.some(f => f.includes(block))
}

export const addFinal = (finals: readonly string[], answer: string) => [...finals, answer].slice(-FINALS_KEPT)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS, 27 tests (17 existing + 10 new), 0 fail.

Run: `npx -y -p typescript tsc -p . --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/clean.ts hooks/clean.test.ts
git commit -m "feat: Clean View checklist and card logic"
```

---

### Task 3: The Clean View hooks module

**Files:**
- Create: `hooks/clean-view.tsx`
- Modify: `hooks/hooks.json`

**Interfaces:**
- Consumes: Task 2's `addFinal`, `BAR_CELLS`, `card`, `isFinalAnswer`, `startChecklist`, `taskCreated`, `taskUpdated`, `todosWritten`, `turnEnded`; `modelColor` from `hooks/format.ts`; Task 1's ruling for `HIDDEN`; state keys `statusbar.cleanView`, `statusbar.checklist`, `statusbar.finals`, `statusbar.figures`.
- Produces: the module; `$.store` key `cleanView`; nothing exported.

- [ ] **Step 1: Register the module**

Replace `hooks/hooks.json` with:

```json
{ "modules": ["./register.tsx", "./clean-view.tsx"] }
```

- [ ] **Step 2: Write `hooks/clean-view.tsx`**

If Task 1 ruled `HIDDEN = empty Box`, every `return null` marked `// HIDDEN` below becomes
`{ const { Box } = $.ui.resolve(e); return <Box /> }`.

```tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  BAR_CELLS, addFinal, card, isFinalAnswer, startChecklist, taskCreated, taskUpdated, todosWritten, turnEnded,
} from './clean'
import { modelColor } from './format'

const cleanView = atom({ plugin: 'statusbar', key: 'cleanView' } as const, false)
const checklist = atom({ plugin: 'statusbar', key: 'checklist' } as const, null)
const finals = atom({ plugin: 'statusbar', key: 'finals' } as const, [])
const figures = atom({ plugin: 'statusbar', key: 'figures' } as const, null)

const CLEAN_VIEW_SECTION = 'The person is using Clean View: they see a checklist of your tasks, not your tool calls. '
  + 'Before working on a request, break it into a few short tasks with TaskCreate (subject: a plain-language step, '
  + 'under 50 characters). Mark each task in_progress when you start it and completed when it is done. '
  + 'For a quick question, one task is enough.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const stored = await $.store.get('cleanView')
    await update($, cleanView, () => stored === true)
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (await read($, cleanView)) {
      const now = await $.clock.now()
      await update($, checklist, () => startChecklist(e.text, now))
    }
    return next(e)
  })

  // Claude's task calls build the card; a subagent's own tasks are not the person's request
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      const { id, subject } = r.result.task
      await update($, checklist, c => c && taskCreated(c, id, subject))
    }
    return r
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      await update($, checklist, c => c && taskUpdated(c, { taskId: e.taskId, subject: e.subject, status: e.status }))
    }
    return r
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      await update($, checklist, c => c && todosWritten(c, e.todos))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await update($, finals, list => addFinal(list, e.answer))
    if (await read($, cleanView)) {
      const now = await $.clock.now()
      const outcome = e.reason === 'answer' && !e.isAborted ? 'answer' : 'stopped'
      await update($, checklist, c => c && c.endedAt === undefined ? turnEnded(c, now, outcome) : c)
    }
    return r
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, cleanView))) return r
    return { ...r, sections: [...r.sections, { id: 'statusbar.clean-view', text: CLEAN_VIEW_SECTION, scope: 'session' as const }] }
  })

  // Drawing only: the stored transcript is untouched, so switching Clean View off shows every row again
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (await read($, cleanView)) ? null : next(e)) // HIDDEN
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => (await read($, cleanView)) ? null : next(e)) // HIDDEN
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => (await read($, cleanView)) ? null : next(e)) // HIDDEN
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (await read($, cleanView)) ? null : next(e)) // HIDDEN

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const [isOn, list] = await Promise.all([read($, cleanView), read($, finals)])
    if (!isOn || isFinalAnswer(e.props.text, list)) return next(e)
    return null // HIDDEN
  })

  // The card, above whatever else the band holds (the picker draws above this in register.tsx)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [isOn, c, f, below] = await Promise.all([read($, cleanView), read($, checklist), read($, figures), next(e)])
    if (!isOn || c === null || e.props.hasSurvey) return below

    const { Box, Text } = $.ui.resolve(e)
    const accent = modelColor(f?.model ?? '')
    const k = card(c, await $.clock.now(), accent)

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
          <Text bold><Text color={accent}>✧ </Text>{k.title}</Text>
          {k.step && (
            <Box>
              <Box width={14}><Text>{k.step}</Text></Box>
              <Text color={accent}>{'▓'.repeat(k.filled)}</Text>
              <Text dimColor>{'░'.repeat(BAR_CELLS - k.filled)}</Text>
            </Box>
          )}
          {k.rows.map((row, i) => (
            <Box key={`task${i}`}>
              <Box flexGrow={1}>
                <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>{row.mark} {row.subject}</Text>
              </Box>
              <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>  {row.label}</Text>
            </Box>
          ))}
          {k.footer && <Text color={c.outcome === 'answer' ? 'green' : undefined} dimColor={c.outcome !== 'answer'}>{k.footer}</Text>}
        </Box>
      </Box>
    )
  })
}
```

- [ ] **Step 3: Validate and type-check**

Run: `claude plugin validate .`
Expected: `✔ Validation passed`; the hooks list for `./clean-view.tsx` reads `session.start, turn.start, tool.call{tool=TaskCreate}, tool.call{tool=TaskUpdate}, tool.call{tool=TodoWrite}, turn.complete, prompt.compose, ui.render{component=ToolUse}, ui.render{component=ToolResult}, ui.render{component=ToolGroup}, ui.render{component=ToolProgress}, ui.render{component=AssistantMessage}, ui.render{component=AbovePrompt}`; calls include `$.store.get`.

If the validator names `turn.start` as streaming (like `turn.step`), rewrite that hook as `async function* ($, e, next) { …; return yield* next(e) }` and ledger it.

Run: `npx -y -p typescript tsc -p . --noEmit`
Expected: exit 0. If `e.agentId`, `e.answer`, `e.reason` or `e.isAborted` do not type-check, grep `.claude-plugin/types/claude-code/index.d.ts` for `AgentLoop` and `TurnCompleteFields`, use the declared names, and ledger the change.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test .`
Expected: PASS, 27 tests.

- [ ] **Step 5: Commit**

```bash
git add hooks/hooks.json hooks/clean-view.tsx
git commit -m "feat: Clean View module: checklist from task calls, hidden work rows, card above the prompt"
```

---

### Task 4: The picker row and `◐ Clean` on row 1

**Files:**
- Modify: `hooks/format.ts`, `hooks/format.test.ts`
- Modify: `hooks/register.tsx`

**Interfaces:**
- Consumes: `StatusFigures.isClean` and state key `statusbar.cleanView` from Task 2; `$.store` key `cleanView` read by Task 3.
- Produces: the toggle.

- [ ] **Step 1: Write the failing row 1 test**

In `hooks/format.test.ts`, add inside `describe('statusbar rows', …)` after `no git segment outside a repo`:

```ts
  test('row 1 shows ◐ Clean after the button while Clean View is on', async () => {
    const [on = []] = rows({ ...base, isClean: true })
    expect(plain(on)).toBe('[Opus 5.5] ⚙ Command ◐ Clean | 📁 main-2 | 🌿 main +1~2')
    expect(colorOf(on, '◐')).toBe('green')
    const [off = []] = rows(base)
    expect(plain(off)).not.toContain('◐')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `claude plugin test .`
Expected: FAIL on `row 1 shows ◐ Clean…` (no `◐ Clean` in the row).

- [ ] **Step 3: Add the segment in `format.ts`**

In `rows`, replace

```ts
      { text: '⚙ Command', isPicker: true },
```

with

```ts
      { text: '⚙ Command', isPicker: true },
      ...(f.isClean ? [{ text: ' ◐ Clean', color: 'green' }] : []),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS, 28 tests.

- [ ] **Step 5: Wire the toggle in `register.tsx`**

Add after the `isPickerOpen` atom:

```ts
const cleanView = atom({ plugin: 'statusbar', key: 'cleanView' } as const, false)

// Kept across sessions in the plugin's store; clean-view.tsx reads it back at session start
const setCleanView = async ($: EngineInterface, isOn: boolean) => {
  await update($, cleanView, () => isOn)
  await $.store.set('cleanView', isOn)
}
```

In the `PromptHint` hook, replace

```tsx
    const [f, hint] = await Promise.all([read($, figures), next(e)])
```

with

```tsx
    const [f, hint, isClean] = await Promise.all([read($, figures), next(e), read($, cleanView)])
```

and replace `{rows(f).map((row, i) => (` with `{rows({ ...f, isClean }).map((row, i) => (`.

In the `AbovePrompt` hook, replace

```tsx
    const [isOpen, f] = await Promise.all([read($, isPickerOpen), read($, figures)])
    if (!isOpen || f === null || e.props.hasSurvey) return next(e)
```

with

```tsx
    // The picker draws above what the band already holds (the Clean View card)
    const [isOpen, f, isClean, below] = await Promise.all([read($, isPickerOpen), read($, figures), read($, cleanView), next(e)])
    if (!isOpen || f === null || e.props.hasSurvey) return below
```

Widen the row labels so `CLEAN VIEW` fits: replace both `<Box width={8}>` with `<Box width={12}>`.

Replace the picker's `return (` block's outer element so the picker sits above `below`, and add the third row:

```tsx
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={modelColor(f.model)} paddingX={1}>
          <Box>
            <Box width={12}><Text dimColor>MODEL</Text></Box>
            {MODELS.map(m => option(`model-${m.id}`, m.label,
              sameModel(m.id, f.model) ? modelColor(m.id) : undefined, () => void pickModel(m.id)))}
            <Box flexGrow={1} />
            <Button key="close" plain label="✕" onPress={() => void closePicker($)} />
          </Box>
          <Box>
            <Box width={12}><Text dimColor>EFFORT</Text></Box>
            {EFFORTS.map(level => option(`effort-${level}`, level.charAt(0).toUpperCase() + level.slice(1),
              level === f.effort ? effortColor(level) : undefined, () => void pickEffort(level)))}
          </Box>
          <Box>
            <Box width={12}><Text dimColor>CLEAN VIEW</Text></Box>
            {option('clean-off', 'Off', isClean ? undefined : 'subtle', () => void setCleanView($, false))}
            {option('clean-on', 'On', isClean ? 'green' : undefined, () => void setCleanView($, true))}
          </Box>
        </Box>
        {below}
      </Box>
    )
```

- [ ] **Step 6: Validate, type-check, test**

Run: `claude plugin validate .`
Expected: `✔ Validation passed`; `./register.tsx` calls include `$.store.set`; state reads and writes include `statusbar.cleanView`.

Run: `npx -y -p typescript tsc -p . --noEmit`
Expected: exit 0.

Run: `claude plugin test .`
Expected: PASS, 28 tests.

- [ ] **Step 7: Commit**

```bash
git add hooks/format.ts hooks/format.test.ts hooks/register.tsx
git commit -m "feat: Clean View toggle in the picker and ◐ Clean on row 1"
```

---

### Task 5: Docs, version, live check

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Version**

In `.claude-plugin/plugin.json`, change `"version": "0.7.2"` to `"version": "0.8.0"`.

- [ ] **Step 2: README**

Add after the `### Picker` section (before `## When it updates`):

```markdown
### Clean View

Turn it on in the picker (`CLEAN VIEW  Off  On`); it stays on across sessions until you turn it off, and row 1
shows `◐ Clean`. Claude's tool calls, their results, code changes and its in-between notes are hidden; you see your
request, a checklist card above the prompt, and Claude's final answer:

    ╭──────────────────────────────────────────────────╮
    │ ✧ Build a weather dashboard for New York…        │
    │ Step 2 of 4   ▓▓▓▓▓░░░░░░░░░░░░░░░               │
    │ ✓ Pick the page style and layout          Done   │
    │ ● Check how the page gets live weather Working   │
    │ ○ Build the weather dashboard             Next   │
    │ ○ Publish it and share the link        Up next   │
    ╰──────────────────────────────────────────────────╯

While it is on, Claude is asked to break each request into a few tasks first, so the card has a list. When Claude
finishes, the card reads `✓ 4 of 4 done · 3m` until your next request. Permission prompts, Claude's questions to you,
and Claude Code's notices are never hidden. Nothing is deleted: turn Clean View off and every hidden row shows again.
```

In "What it runs", append:

```markdown
With Clean View on, it adds one short instruction to Claude's system prompt asking it to plan each request as tasks.
```

- [ ] **Step 3: CHANGELOG**

Add above `## 0.7.2 (2026-10-06)`:

```markdown
## 0.8.0 (2026-10-06)

### Added

- **Clean View**, a toggle in the Command picker. It hides Claude's tool calls, results, code changes and in-between
  notes, and shows a live checklist card above the prompt (`Step 2 of 4`, each task Done / Working / Next / Up next)
  with Claude's final answer in the transcript. It stays on across sessions; row 1 shows `◐ Clean`. While on, Claude
  is asked to plan each request as tasks. Turn it off and every hidden row shows again.

```

- [ ] **Step 4: Validate, test, scan, commit**

Run: `claude plugin validate . && claude plugin test . && npx -y -p typescript tsc -p . --noEmit`
Expected: validation passes, 28 tests pass, tsc exit 0.

Run: `git grep -nIiE '(ghp_|gho_|sk-ant|/Users/|/private/tmp)' -- ':!docs/superpowers/plans' || echo clean`
Expected: `clean`.

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "docs: Clean View in the README and CHANGELOG; version 0.8.0"
```

- [ ] **Step 5: Scripted live run**

With Clean View switched on through the store (so the run needs no click), in a pseudo-terminal session started with
`claude --plugin-dir ~/statusbar --debug`: send `Create a file clean-view-probe.txt containing hello, then tell me you are done.`
in a temporary git-ignored folder (`~/statusbar/.superpowers/sdd/live/`), wait for the turn to end, then check:

- the debug log has no `refused` line for `statusbar` and shows `tool.call` settling for `TaskCreate`;
- the screen text has the card's `✓` footer and the final answer, and not the `Write(` tool row.

Turn Clean View back off in the store afterwards (`$.store` file under `~/.claude/plugins/store/statusbar_inline-*.json`,
key `cleanView`) and delete the temporary folder.

- [ ] **Step 6: The person's live check**

Ask the person to run `claude --plugin-dir ~/statusbar`, open the picker, switch Clean View on, ask for a small
multi-step change, and confirm: the card fills in, tool rows are hidden, the final answer shows, and switching Clean
View off shows everything again.
