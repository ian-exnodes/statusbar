# Model and Effort Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the session's effort next to a model name colored by family on row 1 of the status bar, and let a `⚙` button open a small picker that switches model and effort.

**Architecture:** Pure display logic (colors, effort parsing, row 1 segments) goes in `hooks/format.ts` and is unit tested. `hooks/register.tsx` gains the effort source (settings, `/effort`, `turn.step`), redraws after `/model` and `/effort`, and draws the picker in the band above the prompt (`ui.render` on `AbovePrompt`), which runs `/model` and `/effort` through `$.command.run`.

**Tech Stack:** Claude Code plugin function hooks (TSX against the `claude-code` module), `claude plugin validate`, `claude plugin test` (`claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-10-06-model-effort-picker-design.md`

## Global Constraints

- Requires Claude Code 2.1.290 or later; no new dependencies, no new files beyond those listed.
- Work on branch `feat/model-effort-picker`; `main` is protected and the local branch-guard hook refuses edits on it.
- Commits use conventional messages with no Co-Authored-By trailer.
- Model colors: Opus `magenta`, Sonnet `blue`, Haiku `green`, Fable `yellow`, anything else `cyan`.
- Effort colors: `low` `subtle`, `medium` `cyan`, `high` `yellow`, `xhigh` `#ff8700`, `max` `red`.
- Picker models, in order: Haiku 4.5 `claude-haiku-4-5-20251001`, Sonnet 5.5 `claude-sonnet-5-5`, Opus 5.5 `claude-opus-5-5`, Fable 5.1 `claude-fable-5-1`.
- Effort levels, in order: `low`, `medium`, `high`, `xhigh`, `max`.
- Row 1 reads `[Opus 5.5] high ⚙ 📁 <dir> | 🌿 <branch> +N~M`; effort omitted when unknown.
- The picker opens and closes with `⚙` or `/statusbar`; it closes on `✕` or a prompt the person submits; it does not close on Esc.

## Review Focus

- `/effort` run bare, with `auto`, or in capitals (`/effort High`): row 1 shows a level only for the five known levels, matched case-insensitively; anything else leaves the last known level.
- A gateway or Bedrock model id (`some-gateway-model`, `us.anthropic.claude-opus-5-5-v1`): unknown ids stay cyan; ids containing `claude-<family>-<digit>` take the family color.
- An older model of a known family (`claude-opus-4-1`): colored magenta on row 1, but the picker does not mark Opus 5.5 as current.
- No effort known yet (no `effortLevel` in settings, no turn sent): row 1 shows `[Opus 5.5] ⚙ 📁 …` with no blank or `undefined`.
- `turn.step` carrying a numeric effort: ignored, the shown level stays.
- A pick in the picker (its `/model` or `/effort` run): the picker stays open; only the person's own prompt closes it.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `types/index.d.ts` | State contract and figure types | `StatusEffort`, `StatusFigures.effort`, state keys `effort`, `isPickerOpen` |
| `hooks/format.ts` | Pure display logic | `EFFORTS`, `MODELS`, `modelColor`, `effortColor`, `parseEffort`, `sameModel`; row 1 gains effort and the `⚙` segment |
| `hooks/format.test.ts` | Unit tests for `format.ts` | New tests; row 1 expectations updated |
| `hooks/register.tsx` | Hooks: data, status row, picker | Effort source, `/model` and `/effort` listeners, `⚙` Button, picker band |
| `README.md` | User docs | Row 1 table, Picker section, "What it runs" |
| `.claude-plugin/plugin.json` | Manifest | `version` `0.7.0` |

---

### Task 1: Colors, effort parsing and row 1 in `format.ts`

**Files:**
- Modify: `types/index.d.ts`
- Modify: `hooks/format.ts`
- Test: `hooks/format.test.ts`

**Interfaces:**
- Produces (in `types/index.d.ts`): `export type StatusEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`; `StatusFigures.effort?: StatusEffort`; `PluginState['statusbar']` gains `effort: StatusEffort | null` and `isPickerOpen: boolean`.
- Produces (in `hooks/format.ts`):
  - `Segment = { text: string; color?: string; isPicker?: true }`
  - `EFFORTS: readonly StatusEffort[]`
  - `MODELS: readonly { id: string; label: string }[]`
  - `modelColor(id: string): string`
  - `effortColor(level: StatusEffort): string`
  - `parseEffort(value: unknown): StatusEffort | undefined`
  - `sameModel(a: string, b: string): boolean`
  - `rows(f)` row 1: model, optional effort, `' '`, `{ text: '⚙', isPicker: true }`, dir, git

- [ ] **Step 1: Update the types contract**

Replace `types/index.d.ts` with:

```ts
/** A usage-limit window and how much of it is left, 0 to 100. */
export type StatusQuota = { label: string; remaining: number }

/** A reasoning effort level, as /effort takes it. */
export type StatusEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type StatusFigures = {
  model: string
  /** The session's effort; absent until settings, /effort or a turn names one. */
  effort?: StatusEffort
  dir: string
  branch?: string
  staged: number
  modified: number
  percent: number
  tokensIn: number
  tokensOut: number
  usd: number
  ms: number
  /** Context tokens the last turn added (negative after a compaction); absent before a second turn. */
  turnDelta?: number
  /** 5h and 7d windows; empty off a Claude subscription or before the first reading. */
  quotas: StatusQuota[]
}

declare module 'claude-code' {
  interface PluginState {
    'statusbar': {
      figures: StatusFigures | null
      tokensOut: number
      lastTurnTokens: number | null
      turnDelta: number | null
      effort: StatusEffort | null
      isPickerOpen: boolean
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

In `hooks/format.test.ts`, change the import line to:

```ts
import { barColor, effortColor, modelColor, parseEffort, prettyModel, quotaColor, quotas, rows, sameModel, tokens } from './format'
```

In the test `two rows with the statusline.sh text and colors`, change the two row 1 expectations to:

```ts
    expect(plain(top)).toBe('[Opus 5.5] ⚙ 📁 main-2 | 🌿 main +1~2')
```

```ts
    expect(colorOf(top, 'Opus')).toBe('magenta')
```

Add these tests inside `describe('statusbar rows', …)`, after `no git segment outside a repo`:

```ts
  test('the model is colored by family; unknown ids stay cyan', async () => {
    expect(modelColor('claude-opus-5-5')).toBe('magenta')
    expect(modelColor('claude-opus-5-5[1m]')).toBe('magenta')
    expect(modelColor('claude-sonnet-5-5')).toBe('blue')
    expect(modelColor('claude-haiku-4-5-20251001')).toBe('green')
    expect(modelColor('claude-fable-5-1')).toBe('yellow')
    expect(modelColor('us.anthropic.claude-opus-5-5-v1')).toBe('magenta')
    expect(modelColor('some-gateway-model')).toBe('cyan')
  })

  test('effort colors rise with cost', async () => {
    expect(effortColor('low')).toBe('subtle')
    expect(effortColor('medium')).toBe('cyan')
    expect(effortColor('high')).toBe('yellow')
    expect(effortColor('xhigh')).toBe('#ff8700')
    expect(effortColor('max')).toBe('red')
  })

  test('only the five effort levels are read, in any case', async () => {
    expect(parseEffort('high')).toBe('high')
    expect(parseEffort(' High ')).toBe('high')
    expect(parseEffort('XHIGH')).toBe('xhigh')
    expect(parseEffort('auto')).toBeUndefined()
    expect(parseEffort('')).toBeUndefined()
    expect(parseEffort(5)).toBeUndefined()
    expect(parseEffort(undefined)).toBeUndefined()
  })

  test('the picker marks a model current only for the same version', async () => {
    expect(sameModel('claude-opus-5-5', 'claude-opus-5-5[1m]')).toBe(true)
    expect(sameModel('claude-opus-5-5', 'claude-opus-4-1')).toBe(false)
    expect(sameModel('claude-haiku-4-5-20251001', 'claude-haiku-4-5')).toBe(true)
  })

  test('row 1 shows the effort in its color, then the picker button', async () => {
    const [top = []] = rows({ ...base, effort: 'high' })
    expect(plain(top)).toBe('[Opus 5.5] high ⚙ 📁 main-2 | 🌿 main +1~2')
    expect(colorOf(top, 'high')).toBe('yellow')
    expect(top.find(s => s.isPicker)?.text).toBe('⚙')

    const [unknown = []] = rows(base)
    expect(plain(unknown)).toBe('[Opus 5.5] ⚙ 📁 main-2 | 🌿 main +1~2')
    expect(plain(unknown)).not.toContain('undefined')
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL; the new tests report `modelColor` (and the other new names) as not exported, and `two rows…` fails on the row 1 text.

- [ ] **Step 4: Implement in `format.ts`**

Change the type import at the top of `hooks/format.ts` to:

```ts
import type { StatusEffort, StatusFigures, StatusQuota } from '../types'
```

Change `Segment` to:

```ts
// isPicker: drawn as the button that opens the model and effort picker
export type Segment = { text: string; color?: string; isPicker?: true }
```

Add after `prettyModel`:

```ts
export const EFFORTS: readonly StatusEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// ponytail: no API lists the models a session may use; add a new model here when it ships
export const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
] as const

const FAMILY_COLORS: Record<string, string> = { opus: 'magenta', sonnet: 'blue', haiku: 'green', fable: 'yellow' }

// Not anchored, so a Bedrock or Vertex id (us.anthropic.claude-opus-…) still finds its family
export const modelColor = (id: string) => FAMILY_COLORS[/claude-([a-z]+)-\d/.exec(id)?.[1] ?? ''] ?? 'cyan'

const EFFORT_COLORS: Record<StatusEffort, string> = {
  low: 'subtle', medium: 'cyan', high: 'yellow', xhigh: '#ff8700', max: 'red',
}

export const effortColor = (level: StatusEffort) => EFFORT_COLORS[level]

// From settings, /effort's argument or turn.step: 'auto', '' or a number is not a level to show
export const parseEffort = (value: unknown): StatusEffort | undefined => {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return EFFORTS.find(e => e === level)
}

export const sameModel = (a: string, b: string) => prettyModel(a) === prettyModel(b)
```

In `rows`, replace the row 1 line

```ts
    [{ text: `[${prettyModel(f.model)}]`, color: 'cyan' }, { text: ` 📁 ${f.dir.split('/').pop()}` }, ...git],
```

with:

```ts
    [
      { text: `[${prettyModel(f.model)}]`, color: modelColor(f.model) },
      ...(f.effort ? [{ text: ` ${f.effort}`, color: effortColor(f.effort) }] : []),
      { text: ' ' },
      { text: '⚙', isPicker: true },
      { text: ` 📁 ${f.dir.split('/').pop()}` },
      ...git,
    ],
```

`rows` returns `Segment[][]`; annotate the git array as `Segment[]` (it already is) so the spread segments type-check.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS, 12 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/format.ts hooks/format.test.ts
git commit -m "feat: model colors by family, effort level and picker segment on row 1"
```

---

### Task 2: Effort source and live redraw in `register.tsx`

**Files:**
- Modify: `hooks/register.tsx`

**Interfaces:**
- Consumes: `parseEffort`, `rows`, `Segment.isPicker` from Task 1; state key `statusbar.effort`.
- Produces: `figures.effort` kept current; the `⚙` segment drawn as plain text (Task 3 makes it a Button).

- [ ] **Step 1: Add the effort atom and read it in `refresh`**

Change the `format` import to:

```ts
import { parseEffort, quotas, rows } from './format'
```

Add after the `turnDelta` atom:

```ts
const effort = atom({ plugin: 'statusbar', key: 'effort' } as const, null)
```

In `refresh`, replace the first `Promise.all` with:

```ts
  const [model, dir, usage, now, out, delta, picked, settings] = await Promise.all([
    $.session.model(), $.session.cwd(), $.session.usage(), $.clock.now(), read($, tokensOut), read($, turnDelta),
    read($, effort), $.settings.read(),
  ])
```

and in the object passed to `update($, figures, …)`, add after `model,`:

```ts
    // The last level /effort or a turn named, else the settings' default
    effort: picked ?? parseEffort((settings as { effortLevel?: unknown }).effortLevel),
```

- [ ] **Step 2: Add the `turn.step`, `/effort` and `/model` hooks**

Inside `register`, after the `turn.complete` hook, add:

```tsx
  // The level each request actually carries, after any downgrade for the model
  on('turn.step', async function* ($, e, next) {
    const level = parseEffort(e.effort)
    if (level) {
      await update($, effort, () => level)
      await update($, figures, f => f && { ...f, effort: level })
    }
    return yield* next(e)
  })

  // Typed or run from the picker: redraw right after, not at the next turn
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const level = parseEffort(e.args)
    if (level) await update($, effort, () => level)
    await refresh($)
    return r
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })
```

- [ ] **Step 3: Validate and type-check**

Run: `claude plugin validate .`
Expected: `✔ Validation passed`; the hooks line lists `turn.step, command.run{command=effort}, command.run{command=model}`; state reads and writes include `statusbar.effort`.

Run: `npx -y -p typescript tsc -p . --noEmit`
Expected: no output, exit 0.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test .`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add hooks/register.tsx
git commit -m "feat: track session effort from settings, /effort and each turn"
```

---

### Task 3: The `⚙` button and the picker band

**Files:**
- Modify: `hooks/register.tsx`

**Interfaces:**
- Consumes: `MODELS`, `EFFORTS`, `modelColor`, `effortColor`, `sameModel` from Task 1; `figures` with `effort` from Task 2; state key `statusbar.isPickerOpen`.
- Produces: the picker; nothing later depends on it.

- [ ] **Step 1: Add the open flag and draw `⚙` as a Button**

Change the `format` import to:

```ts
import { EFFORTS, MODELS, effortColor, modelColor, parseEffort, quotas, rows, sameModel } from './format'
```

Add after the `effort` atom:

```ts
const isPickerOpen = atom({ plugin: 'statusbar', key: 'isPickerOpen' } as const, false)
```

In the `PromptHint` render hook, change `const { Box, Text } = $.ui.resolve(e)` to

```tsx
    const { Box, Text, Button } = $.ui.resolve(e)
```

and replace the segment map

```tsx
            {row.map(s => <Text color={s.color}>{s.text}</Text>)}
```

with:

```tsx
            {row.map(s => s.isPicker
              ? <Button key="picker" plain label={s.text} onPress={() => void update($, isPickerOpen, open => !open)} />
              : <Text color={s.color}>{s.text}</Text>)}
```

- [ ] **Step 2: Add the picker band, close-on-submit and `/statusbar`**

In the `session.start` hook, after `const r = await next(e)`, add:

```tsx
    await $.command.register({ name: 'statusbar', description: 'Open or close the model and effort picker' })
```

Inside `register`, after the `PromptHint` hook, add:

```tsx
  // The person sending a message closes it; the picker's own /model and /effort runs do not
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') await update($, isPickerOpen, () => false)
    return next(e)
  })

  // A second way in, in case a click on ⚙ under the prompt does not reach the plugin
  on('command.run', { command: 'statusbar' }, async $ => {
    await update($, isPickerOpen, open => !open)
    return { text: '' }
  })

  // The picker: a band above the prompt, so it stays a few rows tall in every layout (a pane docks full height)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [isOpen, f] = await Promise.all([read($, isPickerOpen), read($, figures)])
    if (!isOpen || f === null || e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    // Same as typing it, so Claude Code's own checks (the model-switch confirm) still apply
    const run = (command: 'model' | 'effort', args: string) =>
      void $.command.run({ command, args }).catch(err => $.ui.toast(`statusbar: /${command} ${args} failed: ${String(err)}`))
    const option = (key: string, label: string, fill: string | undefined, onPress: () => void) => (
      <Box key={key} backgroundColor={fill} paddingX={1}>
        <Button key={key} plain label={label} hover={{ inverse: true }} onPress={onPress} />
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={modelColor(f.model)} paddingX={1}>
        <Box>
          <Box width={8}><Text dimColor>MODEL</Text></Box>
          {MODELS.map(m => option(`model-${m.id}`, m.label,
            sameModel(m.id, f.model) ? modelColor(m.id) : undefined, () => run('model', m.id)))}
          <Box flexGrow={1} />
          <Button key="close" plain label="✕" onPress={() => void update($, isPickerOpen, () => false)} />
        </Box>
        <Box>
          <Box width={8}><Text dimColor>EFFORT</Text></Box>
          {EFFORTS.map(level => option(`effort-${level}`, level.charAt(0).toUpperCase() + level.slice(1),
            level === f.effort ? effortColor(level) : undefined, () => run('effort', level)))}
        </Box>
      </Box>
    )
  })
```

- [ ] **Step 3: Validate, type-check, test**

Run: `claude plugin validate .`
Expected: `✔ Validation passed`; hooks include `prompt.submit, command.run{command=statusbar}, ui.render{component=AbovePrompt}`; calls include `$.command.register, $.command.run, $.settings.read, $.ui.toast`.

Run: `npx -y -p typescript tsc -p . --noEmit`
Expected: exit 0.

Run: `claude plugin test .`
Expected: PASS, 12 tests.

- [ ] **Step 4: Commit**

```bash
git add hooks/register.tsx
git commit -m "feat: gear button opens a model and effort picker above the prompt"
```

---

### Task 4: Docs, version, live check, spike cleanup

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Bump the version**

In `.claude-plugin/plugin.json`, change `"version": "0.6.0"` to `"version": "0.7.0"`.

- [ ] **Step 2: Update the README**

Replace the example block near the top with:

```
[Opus 5.5] high ⚙ 📁 main-2 | 🌿 main +1~2
██░░░░░░░░ 21% | 5h ███████░░░ 76% | 7d █████████░ 92% | ↑ 208.1k ↓ 36.8k | $5.79 | ⏱️ 52m 47s | ▲ +21.4k last turn
```

In the "Row 1: where you are" table, replace the `[Opus 5.5]` row with these three rows:

```markdown
| `[Opus 5.5]` | The model this session runs on, colored by family: Opus magenta, Sonnet blue, Haiku green, Fable yellow. Other models are cyan. |
| `high` | The session's reasoning effort, colored by cost: low gray, medium cyan, high yellow, xhigh orange, max red. Hidden until known. |
| `⚙` | Opens the model and effort picker. |
```

Add this section after the "Row 2" section:

```markdown
### Picker

Press `⚙` (or run `/statusbar`) to open a small box above the prompt:

    MODEL   Haiku 4.5  Sonnet 5.5  Opus 5.5  Fable 5.1   ✕
    EFFORT  Low  Medium  High  Xhigh  Max

The current model and effort are highlighted. Picking one runs `/model` or `/effort` for you, for this
session only. In a long conversation, switching model or effort can show Claude Code's own confirmation,
because the change makes the model read the whole conversation again; if you cancel, nothing changes.
The box closes on `✕` or when you send a message.
```

In "What it runs", append this sentence:

```markdown
When you pick in the picker, it runs `/model` or `/effort`, as if you typed them.
```

- [ ] **Step 3: Validate and test**

Run: `claude plugin validate .` and `claude plugin test .`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add README.md .claude-plugin/plugin.json
git commit -m "docs: model, effort and picker in the README; version 0.7.0"
```

- [ ] **Step 5: Live check (needs the person at the keyboard)**

Ask the person to start `claude --plugin-dir ~/statusbar` in a new terminal. If two status bars appear (the installed one and this one), run `claude plugin disable statusbar@ian-exnodes` there and restart; re-enable after with `claude plugin enable statusbar@ian-exnodes`.

They check:
1. Row 1 reads `[Opus 5.5] high ⚙ …` before the first prompt, model magenta, `high` yellow.
2. Clicking `⚙` opens the picker; clicking it again closes it. `/statusbar` does the same.
3. `Medium` turns row 1's effort cyan, Claude Code's own `/effort` hint changes, and the picker stays open.
4. `Sonnet 5.5` (confirm if asked) turns the model blue and the picker border blue.
5. `✕` closes the picker; so does sending a message.

If the click on `⚙` never opens it, `/statusbar` is the way in; say so in the README's Picker section.

