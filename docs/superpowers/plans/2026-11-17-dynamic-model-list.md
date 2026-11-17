# Dynamic Picker Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The picker's MODEL row takes its families from Claude Code's `/config` Model row and labels each with the newest version the person has run, so a new model needs no code change.

**Architecture:** Pure functions in `hooks/format.ts` turn the Model row's options into families and a family → newest id map into picker buttons. `hooks/register.tsx` reads `$.config.list()` at session start and when the picker opens, records the session's model in `$.store` (`latestModels`) on each refresh, and switches by alias for family buttons.

**Tech Stack:** TypeScript plugin on Claude Code's mod engine (`claude-code`, `claude-code/testing`), tests via `claude plugin test .`.

**Spec:** `docs/superpowers/specs/2026-11-17-dynamic-model-list-design.md`

## Global Constraints

- Families: options of the `/config` row with key `model` that match `/^[a-z]+$/`, minus `default`, `best` and words ending in `plan`.
- Order: `haiku, sonnet, opus, fable`, then new families in the order Claude Code lists them.
- Fallback when the read fails, the row is missing or nothing is left: `haiku, sonnet, opus, fable`.
- Label: `prettyModel(id)` when the family's newest id is known, else the family name capitalized (`Opus`).
- A stored version is replaced only by a newer one.
- No API calls, no network.
- `PICKER_MAX` stays 6; the current model keeps a slot.
- Release: plugin version `0.9.14`.

## Review Focus

1. A Bedrock/Vertex session model (`us.anthropic.claude-opus-5-5-v1`): `prettyModel` does not shorten it, so it must not become a family label. Only ids starting with `claude-` are recorded (Task 1 test).
2. A corrupt or foreign `latestModels` value in the store (a string, an array): the picker still draws the family buttons (Task 2 test).
3. A `[1m]` session model (`claude-opus-5-5[1m]`): the Opus button lights and no extra slot appears (Task 1 test).
4. The refresh runs often: the same model seen again must not write the store (Task 1 `withSeen` returns `undefined`; Task 2 asserts no write).
5. `config.list` rejecting: the four fallback families still show (Task 2 test).

---

### Task 1: Families, seen versions and picker buttons in `format.ts`

**Files:**
- Modify: `hooks/format.ts:15-21` (`MODELS`), `hooks/format.ts:52-75` (`PickerModel`, `pickerModels`)
- Test: `hooks/format.test.ts:233-252` (the `the model picker` describe)

**Interfaces:**
- Produces:
  - `export const FAMILIES: readonly string[]` = `['haiku', 'sonnet', 'opus', 'fable']`
  - `export type PickerModel = { id: string; label: string; alias?: string }`. A family button has `alias` (the family) and `id` = its newest known id, or the alias when none is known. An older-version slot has no `alias`.
  - `export type SeenModels = Record<string, string>` (family → newest id)
  - `export const familiesFrom = (options: readonly string[] | undefined): string[]`
  - `export const withSeen = (seen: SeenModels, id: string): SeenModels | undefined`: a new map when `id` starts with `claude-`, has a family, and is newer than the stored id for that family (or none is stored); `undefined` otherwise.
  - `export const pickerModels = (settings: EffortSettings, current?: string, families: readonly string[] = FAMILIES, seen: SeenModels = {}): PickerModel[]`
- Keep `MODELS` exported, unchanged, in this task so `register.tsx` still compiles. Task 2 removes it.

- [ ] **Step 1: Replace the `the model picker` describe in `hooks/format.test.ts` with these tests** (import `FAMILIES`, `familiesFrom`, `withSeen`)

```ts
const ROW = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']
const labels = (...a: Parameters<typeof pickerModels>) => pickerModels(...a).map(m => m.label)

test('families come from the Model row: bare names in a fixed order, new ones after', async () => {
  expect(familiesFrom(ROW)).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
  expect(familiesFrom(['default', 'zeta', 'sonnet', 'opus', 'haiku', 'fable', 'zetaplan'])).toEqual(['haiku', 'sonnet', 'opus', 'fable', 'zeta'])
  expect(familiesFrom(undefined)).toEqual([...FAMILIES])
  expect(familiesFrom([])).toEqual([...FAMILIES])
  expect(familiesFrom(['default', 'best'])).toEqual([...FAMILIES])
})

test('a family shows its version once known, else just its name, and switches by alias', async () => {
  expect(labels({}, undefined)).toEqual(['Haiku', 'Sonnet', 'Opus', 'Fable'])
  const seen = { fable: 'claude-fable-5-2', haiku: 'claude-haiku-4-5-20251001' }
  expect(labels({}, 'claude-fable-5-2', FAMILIES, seen)).toEqual(['Haiku 4.5', 'Sonnet', 'Opus', 'Fable 5.2'])
  const models = pickerModels({}, 'claude-fable-5-2', FAMILIES, seen)
  expect(models[3]).toEqual({ id: 'claude-fable-5-2', label: 'Fable 5.2', alias: 'fable' })
  expect(models[1]).toEqual({ id: 'sonnet', label: 'Sonnet', alias: 'sonnet' })
  expect(labels({}, undefined, ['haiku', 'sonnet', 'opus', 'fable', 'zeta'])).toContain('Zeta')
})

test('the newest id of a family labels its button; older ones from modelSettings get their own slot', async () => {
  const settings = { modelSettings: { 'claude-opus-4-1': {}, 'claude-opus-5-5': {}, default: {}, opus: {}, 'gpt-5': {} } }
  expect(labels(settings, 'claude-opus-5-5')).toEqual(['Haiku', 'Sonnet', 'Opus 5.5', 'Fable', 'Opus 4.1'])
  expect(pickerModels(settings).at(-1)).toEqual({ id: 'claude-opus-4-1', label: 'Opus 4.1' })
})

test('a [1m] session model lights its family button and adds no slot', async () => {
  const models = pickerModels({}, 'claude-opus-5-5[1m]', FAMILIES, { opus: 'claude-opus-5-5[1m]' })
  expect(models).toHaveLength(4)
  expect(models[2]?.label).toBe('Opus 5.5')
})

test('a seen version is replaced only by a newer one, and only for a claude- id', async () => {
  expect(withSeen({}, 'claude-fable-5-2')).toEqual({ fable: 'claude-fable-5-2' })
  expect(withSeen({ opus: 'claude-opus-5-5' }, 'claude-opus-5-6')).toEqual({ opus: 'claude-opus-5-6' })
  expect(withSeen({ opus: 'claude-opus-5-5' }, 'claude-opus-4-1')).toBeUndefined()
  expect(withSeen({ opus: 'claude-opus-5-5' }, 'claude-opus-5-5')).toBeUndefined()
  expect(withSeen({}, 'gpt-5')).toBeUndefined()
  expect(withSeen({}, 'us.anthropic.claude-opus-5-5-v1')).toBeUndefined()
})

test('past the cap, the newest older ids stay and the current model keeps a slot', async () => {
  const many = Object.fromEntries(['1-0', '2-0', '3-0', '3-5', '6-0'].map(v => [`claude-opus-${v}`, {}]))
  expect(labels({ modelSettings: many })).toEqual(['Haiku', 'Sonnet', 'Opus 6.0', 'Fable', 'Opus 3.5', 'Opus 3.0'])
  expect(labels({ modelSettings: many }, 'claude-opus-1-0').slice(4)).toEqual(['Opus 3.5', 'Opus 1.0'])
})
```

- [ ] **Step 2: Run the tests and see the new ones fail**

Run: `claude plugin test .`
Expected: FAIL in `format.test.ts` (`familiesFrom`/`withSeen` not exported, labels still `Opus 5.5`-style from `MODELS`).

- [ ] **Step 3: Implement in `hooks/format.ts`**

`FAMILIES`, `SeenModels`, `familiesFrom`, `withSeen` and the new `pickerModels` with the signatures above. In `pickerModels`: the newest id per family is the highest `version()` among `Object.keys(settings.modelSettings ?? {})`, `Object.values(seen)` and `current`, counting only ids with a `family()`. Each family in `families` becomes a button `{ id: newest ?? family, label, alias: family }`. Then add, newest first, every Claude id from `modelSettings` and `current` that is not `sameModel` with a button already listed. The cap and current-slot rule stay as they are now. Label: `prettyModel(id)` when known, else the family capitalized.

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test .`
Expected: all pass. `register.test.tsx` 'lists a model from modelSettings…' still passes, because the Opus 4.1 slot keeps key `model-claude-opus-4-1`.

- [ ] **Step 5: Commit**

```bash
git add hooks/format.ts hooks/format.test.ts
git commit -m "feat: picker families from the Model row, labelled by the newest version seen"
```

### Task 2: Wire families, seen versions and alias picks into `register.tsx`

**Files:**
- Modify: `hooks/register.tsx:10` (imports), `:184-215` (`refresh`), `:322-337` (`session.start`), `:423-426` (`/statusbar` handler), `:466-472` (`pickModel`), `:486-487` (MODEL row render)
- Modify: `hooks/format.ts` (remove `MODELS`), `types/index.d.ts:52-53` (`models` type and comment)
- Test: `hooks/register.test.tsx` (the `world` helper and the `the model picker` describe)

**Interfaces:**
- Consumes: `FAMILIES`, `familiesFrom`, `withSeen`, `SeenModels`, `PickerModel`, `pickerModels(settings, current, families, seen)` from Task 1.
- Produces: store key `latestModels` (`SeenModels`); `StatusFigures.models?: { id: string; label: string; alias?: string }[]`.

- [ ] **Step 1: Extend the test `World` and add the tests**

Add to `World`: `model?: string` (what `session.model` returns, default `'claude-opus-5-5'`), `modelRow?: string[] | 'fail'` and `storeWrites: string[]`. Add the handler `on('config.list', () => w.modelRow === 'fail' ? { error: new Error('no') } : { value: w.modelRow ? [{ key: 'model', label: 'Model', kind: 'choice', value: 'opus', options: w.modelRow, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] : [] })`, using whatever rejection shape the mock kit's other handlers use. Record `store.set` keys in `storeWrites`. Tests in `the model picker`:

```ts
test('a family Claude Code adds shows up, and picking it sets the alias', async ($, on) => {
  const w = fresh({ modelRow: ['default', 'sonnet', 'opus', 'haiku', 'fable', 'zeta', 'opusplan'] })
  world(on, w); await start($); await $.command.run(STATUSBAR)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Button', text: 'Zeta' })).toBeDefined()
  await ui.press({ key: 'model-zeta' })
  expect(w.commands).toContain('config model=zeta')
  await ui.unmount()
})

test('the version a session ran on is remembered for the next session', async ($, on) => {
  const w = fresh({ model: 'claude-fable-5-2' })
  world(on, w); await start($)
  w.model = 'claude-opus-5-5'; await start($); await $.command.run(STATUSBAR)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Button', text: 'Fable 5.2' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Opus 5.5' })).toBeDefined()
  await ui.unmount()
})

test('the same model again does not write the store', async ($, on) => {
  const w = fresh(); world(on, w); await start($)
  const writes = w.storeWrites.filter(k => k === 'latestModels').length
  await $.session.measure?.({ changed: [] } as never) // or any refresh trigger the file already uses
  expect(w.storeWrites.filter(k => k === 'latestModels').length).toBe(writes)
})

test('without the Model row, or with a broken store value, the four families still show', async ($, on) => {
  const w = fresh({ modelRow: 'fail', store: { latestModels: 'junk' } })
  world(on, w); await start($); await $.command.run(STATUSBAR)
  const ui = await $.ui.mount(BAND)
  for (const text of ['Haiku', 'Sonnet', 'Opus 5.5', 'Fable']) expect(await ui.find({ type: 'Button', text })).toBeDefined()
  await ui.unmount()
})
```

For the third test, trigger the refresh the way existing tests in the file already do. The comment shows the intent, not a required call.

- [ ] **Step 2: Run the tests and see the new ones fail**

Run: `claude plugin test .`
Expected: FAIL. No `Zeta` button, `Fable 5.2` not remembered.

- [ ] **Step 3: Implement**

- A top-level `let families: readonly string[] = FAMILIES` in `register.tsx`, and `readFamilies($)`: `$.config.list()`, then `familiesFrom(row with key 'model'?.options)`. On rejection, `FAMILIES`. Call it in `session.start` before `setUp($)`, and in the `/statusbar` handler before `togglePicker($)`.
- `refresh`: read `$.store.get('latestModels')`. Treat anything other than a plain object of string values as `{}`. If `withSeen(seen, model)` returns a map, `$.store.set('latestModels', it)` (a failed write is ignored) and use it. Pass `families` and `seen` to `pickerModels`.
- `pickModel(m: PickerModel)`: if `m.alias`, run `$.config.set({ key: 'model', value: m.alias })`. On deny or rejection, run `run('model', m.alias)`. Otherwise run `run('model', m.id)`. Then update `figures.model` as now.
- Render: `(f.models ?? pickerModels({}, f.model, families))`, button key `model-${m.alias ?? m.id}`, highlight `sameModel(m.id, f.model)` as now.
- Remove `MODELS` from `format.ts` and from the import. Update `types/index.d.ts` `models` to `{ id: string; label: string; alias?: string }[]` with the comment "The picker's models: a button per family from the /config Model row, then older ids from modelSettings."

- [ ] **Step 4: Run the tests and see them pass**

Run: `claude plugin test .` and `claude plugin validate .`
Expected: all tests pass; validate reports no errors.

- [ ] **Step 5: Check it in a real session**

Run the pty harness or `claude --plugin-dir .`, then `/statusbar`. Expected: `MODEL   Haiku …  Sonnet …  Opus …  Fable 5.2` once a Fable 5.2 session has run. Pressing Fable switches to `claude-fable-5-2`.

- [ ] **Step 6: Commit**

```bash
git add hooks/register.tsx hooks/register.test.tsx hooks/format.ts types/index.d.ts
git commit -m "feat: the picker reads its families from /config and remembers versions per family"
```

### Task 3: Docs and release 0.9.14

**Files:**
- Modify: `README.md:88-95` (Picker section), `CHANGELOG.md` (new `## 0.9.14 (<date>)` at the top, `### Changed`), `.claude-plugin/plugin.json` (`version` → `0.9.14`), `docs/superpowers/specs/2026-10-06-model-effort-picker-design.md:60-62`

- [ ] **Step 1: Update the docs**

README: the picker sketch becomes `MODEL   Haiku 4.5  Sonnet 5.5  Opus  Fable 5.2   ✕`. The text explains that the families come from Claude Code's own Model list, so a new family shows up by itself. A button shows the newest version you have run, else just the family name, and always switches to the family's newest model. CHANGELOG 0.9.14: the same in two sentences, plus a note that Fable 5.2 now shows as itself instead of under a "Fable 5.1" label. The old spec gets one line after the "fixed in code" paragraph: "Superseded by 2026-11-17-dynamic-model-list-design.md."

- [ ] **Step 2: Verify**

Run: `claude plugin validate . && claude plugin test .`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json docs/superpowers/specs/2026-10-06-model-effort-picker-design.md docs/superpowers/specs/2026-11-17-dynamic-model-list-design.md docs/superpowers/plans/2026-11-17-dynamic-model-list.md
git commit -m "docs: picker models follow Claude Code's list; release 0.9.14"
```
