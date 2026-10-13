# Statusbar Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One git process per refresh (with a timeout, detached HEAD and untracked files), no idle redraws on the 1s tick, a model picker that also lists models from `modelSettings`, and hook-level tests for `register.tsx`.

**Architecture:** All new logic is a small pure helper in `hooks/format.ts`, tested in `hooks/format.test.ts`; `hooks/register.tsx` only wires it. A new `hooks/register.test.tsx` drives the real hooks through `claude-code/testing` (the engine `$` plus `on` stand-ins beneath the plugin), the same way `thieung-mods/ak-cockpit/tests/cockpit.test.tsx` and `swimtrace/mod/test/band.test.tsx` already do. Task 1 builds that harness first so Tasks 2–4 get hook-level red tests.

**Tech Stack:** TypeScript + JSX on the Claude Code plugin runtime (`claude-code`, `claude-code/testing`), git ≥ 2.11 (`--porcelain=v2`).

**Spec:** No spec file. The four review notes this plan implements, verbatim:

> 1. One git call instead of three. refresh() spawns git branch, git diff --cached --numstat and git diff --numstat on every turn and every session.measure. git status --porcelain=v2 --branch gives branch, staged, unstaged and untracked counts in a single process, handles detached HEAD (which currently renders as an empty 🌿 ), and fixes the documented "untracked files are not counted" gap. A timeout on the call would also stop a slow filesystem from stalling the turn hook.
> 2. Skip the per-second redraw when nothing changed. tick() writes a fresh figures object every second, so the whole row re-renders even in an idle session. Comparing the new values to the current ones and skipping the update when they match keeps the live timer but removes most of the churn. The comment says the 1s cadence is deliberate for the card's timer; the comparison keeps that.
> 3. Discover models instead of hard-coding them. MODELS is a fixed list, which needs a release every time a model ships. The settings file already has modelSettings keyed by model id (you read it for defaultEffort), so merging those keys with the fixed list would make any model the user has touched appear in the picker for free.
> 4. Test the hooks, not only the pure logic. Nothing exercises register.tsx: that the planning note is added once per prompt, that the picker closes on a real prompt but not a plugin one, that a resumed session seeds finals. If claude-code/testing can drive hooks, even a few of these would catch the regressions the changelog shows you've been fixing by hand.

(It can: `test('…', async ($, on) => …)` hands the body the engine and a registrar whose hooks sit beneath the plugin.)

## Global Constraints

- Repo: `~/statusbar` (remote `git@github.com:ian-exnodes/statusbar.git`). Branch from `origin/main` (`243c79d`, thin bars merged): `git switch -c feat/statusbar-perf-models origin/main`.
- Tests run with `claude plugin test .`; CI also runs `claude plugin validate .` (Claude Code `2.1.295`, `.github/workflows/test.yml`). Both must pass before each commit. Baseline: 49 pass.
- Type check: `npx -y -p typescript@5.6.3 tsc -p .` must report no errors (strict, `noUncheckedIndexedAccess`).
- Changelog entries go under `## Unreleased` in `CHANGELOG.md`; do **not** bump `.claude-plugin/plugin.json` (releases bump in their own commit).
- Code style: no semicolons, single quotes, short comments that say why, `ponytail:` comments for deliberate shortcuts. Match `format.ts`.
- No new dependencies, no new atoms, no new files beyond `hooks/register.test.tsx`.

## Review Focus

1. **git times out or can't start** (slow network FS, git missing) → the 🌿 segment keeps its last branch and counts instead of blinking out for a turn. Pinned in Task 2 (`a timed-out git call keeps the last branch`).
2. **Detached HEAD** → row shows `🌿 (a1b2c3d)` (short sha in parentheses), never an empty `🌿 `. Pinned in Task 2 (pure + hook test).
3. **Brand-new repo with no commits** (`# branch.oid (initial)`) → still shows the branch name (`main`), no crash. Pinned in Task 2 (pure test).
4. **Working Clean View card with no task in progress** (`Working…`, nothing animating) → its seconds timer keeps ticking every second; the skip only applies when no card is live. Pinned in Task 3 (`a working card still gets a write every second`).
5. **A `modelSettings` key that is an older id of a family** (`claude-opus-4-1`) → picking it runs `/model claude-opus-4-1`; it must not go through `/config`'s family alias (`opus`), which would switch to Opus 5.5 instead. Junk keys (`default`, `opus`) never show. Pinned in Task 4 (pure + hook test).

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `hooks/format.ts` | modify | + `parseGitStatus`, `GIT_STATUS`, `sameRows`, `pickerModels`; `rows()` draws `?N` |
| `hooks/format.test.ts` | modify | pure tests for the above; fixture gains `untracked` |
| `hooks/register.tsx` | modify | `refresh()` one git call; `tick()` skip; picker maps `f.models` |
| `hooks/register.test.tsx` | **create** | engine-driven hook tests + the `world()` harness |
| `types/index.d.ts` | modify | `StatusFigures.untracked`, `StatusFigures.models?` |
| `README.md`, `CHANGELOG.md` | modify | untracked count, detached HEAD, picker discovery |

---

### Task 1: Hook test harness + characterization tests for `register.tsx`

These pin **current** behavior, so they pass on first run. That is expected: they are the safety net for Tasks 2–4, not a red-green cycle.

**Files:**
- Create: `hooks/register.test.tsx`

**Interfaces:**
- Consumes: `CLEAN_VIEW_NOTE` from `hooks/clean.ts`; the plugin's hooks (loaded by the kit from `hooks/hooks.json`).
- Produces (used by Tasks 2–4, same file): `type World`, `world(on: On, w: World): MockClock`, `start($: Engine): Promise<void>`, `fresh(over?: Partial<World>): World`, consts `HINT`, `BAND`, `ok(stdout, exitCode?)`.

- [ ] **Step 1: Write the harness and the three tests**

Create `hooks/register.test.tsx`:

```tsx
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CLEAN_VIEW_NOTE } from './clean'

type World = {
  isClean?: boolean
  /** What `git status` prints; 'timeout' makes the call reject, 'not-a-repo' exits 128. */
  git?: string
  messages?: { role: 'user' | 'assistant'; text: string }[]
  modelSettings?: Record<string, { effortLevel?: string }>
  /** usage.startedAt; the mock clock starts at 0. */
  startedAt?: number
  gitRuns: string[][]
  commands: string[]
  toasts: string[]
  /** How many times the plugin wrote its `figures` atom. */
  figureWrites: number
}

const fresh = (over: Partial<World> = {}): World =>
  ({ git: '# branch.oid abc1234def\n# branch.head main\n', gitRuns: [], commands: [], toasts: [], figureWrites: 0, ...over })

const ok = (stdout: string, exitCode = 0) =>
  ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal' : '', isStdoutTruncated: false, isStderrTruncated: false } })

/** Stands in for the engine and git beneath the plugin. */
function world(on: On, w: World): MockClock {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, w.isClean ? { cleanView: true } : {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/x/statusbar' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: w.startedAt ?? 0, context: { percent: 10, tokens: 20_000, window: 200_000 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: (w.messages ?? []).map(m => ({ ...m, toolUses: [] })) }))
  on('settings.read', () => ({ value: { modelSettings: w.modelSettings ?? {} } as never }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // Without this, Clean View's checklist tool fails to register, the plugin toasts, and Clean View stays off
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__statusbar__${e.name}` } }))
  on('command.run', (_$, e) => { w.commands.push(`${e.command} ${e.args}`.trim()); return { text: '' } })
  on('config.set', () => ({ value: {} as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  // The engine's own drawing beneath the plugin: an answer's text, nothing for the rest
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => { const { Text } = $.ui.resolve(e); return <Text>{e.props.text}</Text> })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('state.set', (_$, e, next) => { if (e.key === 'figures') w.figureWrites++; return next(e) })
  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'git') return ok('')
    w.gitRuns.push([...e.argv])
    if (w.git === 'timeout') return { deny: 'timed out' }
    if (w.git === 'not-a-repo') return ok('', 128)
    return ok(w.git ?? '')
  })
  return clock
}

const start = async ($: Engine) => { await $.session.start({ cwd: '/x/statusbar', surface: 'terminal', isInteractive: true }) }

const HINT = { plugin: 'statusbar', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const
const BAND = {
  plugin: 'statusbar', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const
const COMPOSER = { kind: 'composer' } as const
const PLUGIN = { kind: 'plugin', name: 'other' } as const
const STATUSBAR = { command: 'statusbar', args: '', origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } } as const

describe('register hooks', () => {
  test('Clean View adds its planning note once per prompt, and never to a plugin prompt', async ($, on) => {
    const w = fresh({ isClean: true })
    world(on, w)
    await start($)
    expect(w.toasts).toEqual([])
    const once = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: COMPOSER })
    expect(once.context?.filter(c => c === CLEAN_VIEW_NOTE)).toHaveLength(1)
    const again = await $.prompt.submit({ text: 'and this', wait: false, origin: COMPOSER, context: [CLEAN_VIEW_NOTE] } as never)
    expect(again.context?.filter(c => c === CLEAN_VIEW_NOTE)).toHaveLength(1)
    const other = await $.prompt.submit({ text: 'from a plugin', wait: false, origin: PLUGIN } as never)
    expect(other.context ?? []).not.toContain(CLEAN_VIEW_NOTE)
  })

  test('the picker closes on a prompt the person sends, not on a plugin one', async ($, on) => {
    world(on, fresh())
    await start($)
    await $.command.run(STATUSBAR)
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeDefined()
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: PLUGIN } as never)
    await ui.redraw(BAND.props)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeDefined()
    await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
    await ui.redraw(BAND.props)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeUndefined()
    await ui.unmount()
  })

  test('a resumed session shows its earlier final answers through Clean View, not the notes between', async ($, on) => {
    world(on, fresh({
      isClean: true,
      messages: [
        { role: 'user', text: 'first request' },
        { role: 'assistant', text: 'Let me look.' },
        { role: 'assistant', text: 'Done: the bug was in auth.' },
        { role: 'user', text: 'second request' },
      ],
    }))
    await start($)
    const answer = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Done: the bug was in auth.', isFirstOfReply: true } })
    expect(await answer.find({ text: 'Done: the bug was in auth.' })).toBeDefined()
    await answer.unmount()
    const note = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Let me look.', isFirstOfReply: true } })
    expect(await note.find({ text: 'Let me look.' })).toBeUndefined()
    await note.unmount()
  })
})
```

Notes for the implementer:
- If the final-answer check finds no text, the catch-all `ui.render` stand-in is answering `AssistantMessage` instead of the specific one: swap their order in `world()`.
- `as never` on `prompt.submit` args: `PromptSubmitArgs` omits `origin`/`context` from its type but the kit accepts them (ak-cockpit's test passes `origin`). Keep the cast only where tsc complains.
- If a `config.set` stand-in shape is rejected by tsc, look up `'config.set'` in `.claude-plugin/types/claude-code/index.d.ts` under the result map (~line 7230) and return that type.

- [ ] **Step 2: Run the tests**

Run: `cd ~/statusbar && claude plugin test .`
Expected: PASS, 52 tests (49 + 3). If one fails, the harness is wrong, not the plugin: read the kit's report of skipped hooks (it names the event whose bottom threw) and add the missing stand-in.

- [ ] **Step 3: Prove each test can fail**

Temporarily break each behavior in `hooks/register.tsx` and re-run; each named test must go red, then revert:
1. Line 339: `if (e.origin.kind === 'plugin') return next(e)` → delete the line → picker test fails.
2. Line 98: replace `finalsFromMessages(history)` with `[]` → resumed-session test fails.
3. Line 344: `withCleanViewNote(e.context)` → `[...(e.context ?? []), CLEAN_VIEW_NOTE]` (import it) → note test fails.

Run: `claude plugin test .` after each. Then `git diff hooks/register.tsx` must be empty.

- [ ] **Step 4: Type check and validate**

Run: `npx -y -p typescript@5.6.3 tsc -p . && claude plugin validate .`
Expected: no output from tsc; validate passes.

- [ ] **Step 5: Commit**

```bash
git add hooks/register.test.tsx
git commit -m "test: drive register.tsx hooks: planning note, picker close, resumed finals"
```

---

### Task 2: One `git status --porcelain=v2 --branch` call, with a timeout, detached HEAD and untracked files

**Files:**
- Modify: `hooks/format.ts` (add `GIT_STATUS`, `GIT_TIMEOUT_MS`, `parseGitStatus`; `rows()` git segment)
- Modify: `hooks/format.test.ts` (fixture `base`, git-row expectation, parser tests)
- Modify: `hooks/register.tsx:181-211` (`lines`, `refresh`)
- Modify: `hooks/register.test.tsx` (git tests)
- Modify: `types/index.d.ts` (`StatusFigures.untracked`)
- Modify: `README.md:60-66`, `CHANGELOG.md` (Unreleased)

**Interfaces:**
- Consumes: `world`, `fresh`, `start`, `HINT` from Task 1.
- Produces:
  - `export const GIT_STATUS: readonly string[]` — the argv.
  - `export const GIT_TIMEOUT_MS = 3000`
  - `export type GitFigures = { branch: string; staged: number; modified: number; untracked: number }`
  - `export const parseGitStatus: (stdout: string) => GitFigures`
  - `StatusFigures.untracked: number` (required).

- [ ] **Step 1: Write the failing pure tests**

In `hooks/format.test.ts`, add `parseGitStatus` to the import from `./format`, change the fixture and the row expectation:

```ts
const base = { model: 'claude-opus-5-5', dir: '/x/main-2', branch: 'main', staged: 1, modified: 2, untracked: 3,
  percent: 37, tokensIn: 45_230, tokensOut: 1_200, usd: 1.234, ms: 125_000, quotas: [] }
```

In the test `'two rows with the statusline.sh text and colors'`, change the top-row expectation and add the color check:

```ts
    expect(plain(top)).toBe('[Opus 5.5] ⚙ Command | 📁 main-2 | 🌿 main +1~2?3')
    expect(colorOf(top, '?3')).toBe('subtle')
```

Add a new `describe` at the end of the file:

```ts
describe('git status', () => {
  const v2 = (...lines: string[]) => lines.join('\n') + '\n'

  test('counts staged, unstaged and untracked from one porcelain v2 listing', async () => {
    expect(parseGitStatus(v2(
      '# branch.oid 1234567890abcdef',
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +1 -0',
      '1 M. N... 100644 100644 100644 aaa bbb hooks/a.ts',
      '1 .M N... 100644 100644 100644 aaa bbb hooks/b.ts',
      '1 MM N... 100644 100644 100644 aaa bbb hooks/c.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
      '? notes.md',
      '? scratch/',
    ))).toEqual({ branch: 'feat/x', staged: 3, modified: 3, untracked: 2 })
  })

  test('a detached HEAD shows its short commit, a repo with no commits its branch', async () => {
    expect(parseGitStatus(v2('# branch.oid 1234567890abcdef', '# branch.head (detached)')).branch).toBe('(1234567)')
    expect(parseGitStatus(v2('# branch.oid (initial)', '# branch.head main'))).toEqual({ branch: 'main', staged: 0, modified: 0, untracked: 0 })
  })

  test('the row leaves out counts that are zero', async () => {
    const [top = []] = rows({ ...base, staged: 0, modified: 0, untracked: 0 })
    expect(plain(top)).toEndWith('| 🌿 main ')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test .`
Expected: FAIL — `parseGitStatus` is not exported (import error), and the row test misses `?3`.

- [ ] **Step 3: Implement the parser and the row segment**

In `types/index.d.ts`, in `StatusFigures` after `modified: number`:

```ts
  /** Untracked files; an untracked folder counts once, as `git status` lists it. */
  untracked: number
```

In `hooks/format.ts`, after `quotas`:

```ts
// --no-optional-locks: a plain status refreshes .git/index and can leave the person's own git add facing index.lock
export const GIT_STATUS = ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'] as const
// A slow filesystem stalls the turn hook no longer than this
export const GIT_TIMEOUT_MS = 3000

export type GitFigures = { branch: string; staged: number; modified: number; untracked: number }

// 1/2 = changed/renamed (XY: index, worktree; '.' unchanged), u = conflict (unstaged work), ? = untracked
export const parseGitStatus = (stdout: string): GitFigures => {
  let head = ''
  let oid = ''
  const n = { staged: 0, modified: 0, untracked: 0 }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length)
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length)
    else if (line[0] === '?') n.untracked++
    else if (line[0] === 'u') n.modified++
    else if (line[0] === '1' || line[0] === '2') {
      if (line[2] !== '.') n.staged++
      if (line[3] !== '.') n.modified++
    }
  }
  return { branch: head === '(detached)' ? `(${oid.slice(0, 7)})` : head, ...n }
}
```

In `rows()`, replace the `git` array:

```ts
  const git: Segment[] = f.branch === undefined ? [] : [
    { text: ` | 🌿 ${f.branch} ` },
    ...(f.staged ? [{ text: `+${f.staged}`, color: 'green' }] : []),
    ...(f.modified ? [{ text: `~${f.modified}`, color: 'yellow' }] : []),
    ...(f.untracked ? [{ text: `?${f.untracked}`, color: 'subtle' }] : []),
  ]
```

- [ ] **Step 4: Run the pure tests**

Run: `claude plugin test .`
Expected: the new `format.test.ts` tests PASS. `tsc` will still fail on `register.tsx` (`untracked` missing) until Step 7; that is fine here.

- [ ] **Step 5: Write the failing hook tests**

Append to `hooks/register.test.tsx` (add `GIT_STATUS, GIT_TIMEOUT_MS` imports are not needed; the test reads argv):

```tsx
describe('git on the status bar', () => {
  const v2 = '# branch.oid 1234567890abcdef\n# branch.head main\n1 M. N... 1 1 1 a b x.ts\n1 .M N... 1 1 1 a b y.ts\n? z.md\n'

  test('one git process per refresh, counting untracked files', async ($, on) => {
    const w = fresh({ git: v2 })
    world(on, w)
    await start($)
    expect(w.gitRuns).toEqual([['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch']])
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '?1' })).toBeDefined()
    await ui.unmount()
  })

  test('a detached HEAD shows its short commit, not an empty branch', async ($, on) => {
    world(on, fresh({ git: '# branch.oid 1234567890abcdef\n# branch.head (detached)\n' }))
    await start($)
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 (1234567)' })).toBeDefined()
    await ui.unmount()
  })

  test('outside a repo there is no branch segment', async ($, on) => {
    world(on, fresh({ git: 'not-a-repo' }))
    await start($)
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿' })).toBeUndefined()
    await ui.unmount()
  })

  test('a timed-out git call keeps the last branch and counts', async ($, on) => {
    const w = fresh({ git: v2 })
    world(on, w)
    await start($)
    w.git = 'timeout'
    await $.session.measure({} as never)
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '?1' })).toBeDefined()
    await ui.unmount()
  })
})
```

If `$.session.measure({} as never)` needs real fields, look up `'session.measure'` in the argument map of the d.ts and pass them; the plugin's hook only calls `next(e)` then `refresh`, so any valid input works. A `session.measure` bottom stand-in may also be needed: `on('session.measure', () => ({}) as never)` — use the result type the d.ts names.

- [ ] **Step 6: Run them to see them fail**

Run: `claude plugin test .`
Expected: FAIL — `gitRuns` shows three argv (`branch`, `diff --cached`, `diff`), the untracked and detached texts are missing, and the timeout test loses the branch.

- [ ] **Step 7: Wire `refresh()`**

In `hooks/register.tsx`, extend the `./format` import with `GIT_STATUS, GIT_TIMEOUT_MS, parseGitStatus`. Delete `const lines = …` (line 181). Replace the git part of `refresh` (lines 188–210):

```ts
  // undefined: git timed out or could not start, so the last figures stay; null: not a repo
  const status = await $.process.run(GIT_STATUS, { timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  const git = status === undefined ? undefined : status.exitCode === 0 ? parseGitStatus(status.stdout) : null

  await update($, figures, prev => {
    const g = git === undefined ? prev : git
    return {
      model,
      // The last level /effort, the picker or a turn named, else the level the session started at
      effort: picked ?? defaultEffort(settings as Parameters<typeof defaultEffort>[0], model),
      dir,
      branch: g?.branch,
      staged: g?.staged ?? 0,
      modified: g?.modified ?? 0,
      untracked: g?.untracked ?? 0,
      percent: usage.context.percent ?? 0,
      tokensIn: usage.context.tokens ?? 0,
      tokensOut: out,
      usd: usage.cost?.usd ?? 0,
      ms: now - usage.startedAt,
      turnDelta: delta ?? undefined,
      quotas: quotas(usage.rateLimits),
    }
  })
```

- [ ] **Step 8: Run all tests, type check, validate**

Run: `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p . && claude plugin validate .`
Expected: all PASS (52 + 3 pure + 4 hook = 59), no tsc output.

- [ ] **Step 9: Docs**

`README.md`, in the row-1 table, replace the `~2` row and add two rows after it:

```markdown
| `~2` (yellow) | Files with **unstaged** changes to tracked files, conflicts included. |
| `?3` (dim) | **Untracked** files; an untracked folder counts once. |
| `🌿 (a1b2c3d)` | A detached HEAD shows its short commit in parentheses. |
```

`CHANGELOG.md`, under `## Unreleased`, add:

```markdown
### Fixed

- Untracked files are counted: `?3` after the staged and unstaged counts.
- A detached HEAD shows its short commit, `🌿 (a1b2c3d)`, instead of an empty branch.
- The status bar runs one `git status` per refresh instead of three git commands, gives up after 3 seconds on a
  slow filesystem (keeping the last branch and counts), and no longer takes git's index lock, so it cannot get in
  the way of your own `git add`.
```

- [ ] **Step 10: Commit**

```bash
git add hooks/format.ts hooks/format.test.ts hooks/register.tsx hooks/register.test.tsx types/index.d.ts README.md CHANGELOG.md
git commit -m "perf: one git status per refresh, with a timeout; count untracked files, show detached HEAD"
```

---

### Task 3: Skip the 1s figures write when the rows would draw the same

`ms` changes every tick, so comparing figures field by field never matches. Compare what is drawn: `rows()` shows minutes, cents and rounded percents, so two figures that draw the same rows are the same to the person. The Clean View card reads `$.clock.now()` itself and redraws each second only because `figures` is written; while a card is still working the write stays every second.

**Files:**
- Modify: `hooks/format.ts` (add `sameRows`)
- Modify: `hooks/format.test.ts`
- Modify: `hooks/register.tsx:232-252` (`tick` and its comment)
- Modify: `hooks/register.test.tsx`

**Interfaces:**
- Consumes: `rows`, `StatusFigures`; Task 1's `world` (returns `MockClock`), `w.figureWrites`.
- Produces: `export const sameRows: (a: StatusFigures, b: StatusFigures) => boolean`

- [ ] **Step 1: Write the failing pure test**

Add `sameRows` to the `./format` import in `hooks/format.test.ts` and append to the `'statusbar rows'` describe:

```ts
  test('figures that draw the same rows are the same, though the clock moved', async () => {
    expect(sameRows(base, { ...base, ms: base.ms + 1_000 })).toBe(true)
    expect(sameRows(base, { ...base, usd: 1.2341 })).toBe(true)
    expect(sameRows({ ...base, ms: 59_000 }, { ...base, ms: 60_000 })).toBe(false)
    expect(sameRows(base, { ...base, percent: 38 })).toBe(false)
    expect(sameRows(base, { ...base, quotas: [{ label: '5h', remaining: 50 }] })).toBe(false)
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test .`
Expected: FAIL — `sameRows` is not exported.

- [ ] **Step 3: Implement `sameRows`**

In `hooks/format.ts`, after `rows`:

```ts
// What the person sees is all that counts: the timer shows minutes, so a second that changes nothing drawn is no change
export const sameRows = (a: StatusFigures, b: StatusFigures) => JSON.stringify(rows(a)) === JSON.stringify(rows(b))
```

- [ ] **Step 4: Run it**

Run: `claude plugin test .`
Expected: PASS.

- [ ] **Step 5: Write the failing hook tests**

Append to `hooks/register.test.tsx`:

```tsx
describe('the 1s tick', () => {
  test('an idle second writes nothing; the minute it shows changing writes once', async ($, on) => {
    const w = fresh({ startedAt: 0 })
    const clock = world(on, w)
    await start($)
    await clock.advance(1_000)
    const after = w.figureWrites
    await clock.advance(5_000)
    expect(w.figureWrites).toBe(after)
    await clock.advance(60_000 - clock.now())
    expect(w.figureWrites).toBe(after + 1)
  })

  test('a working card still gets a write every second, for its seconds timer', async ($, on) => {
    const w = fresh({ isClean: true })
    const clock = world(on, w)
    await start($)
    await $.prompt.submit({ text: 'fix the bug', wait: false, origin: COMPOSER })
    await $.turn.start({ text: 'fix the bug', turnId: 't1' })
    const before = w.figureWrites
    await clock.advance(3_000)
    expect(w.figureWrites).toBe(before + 3)
  })
})
```

If `w.figureWrites` stays 0 even after `start` (the kit answers `state.set` above the test's hooks, so the spy never sees it), replace the spy with a count of `PromptHint` renders: mount `HINT` and count calls of a `ui.render` stand-in for `PromptHint` registered before the catch-all; the assertions stay the same.

- [ ] **Step 6: Run them to see them fail**

Run: `claude plugin test .`
Expected: the idle test FAILS (`figureWrites` grows by 5 over the 5 idle seconds); the working-card test PASSES already (it pins behavior the change must keep).

- [ ] **Step 7: Implement the skip in `tick()`**

In `hooks/register.tsx`, add `sameRows` to the `./format` import, and replace the comment block above `tick` (lines 232–235) and its body (lines 236–252):

```ts
// Live figures between events, like a statusLine command re-run by the CLI; git stays on events.
// The model is read here too: no event reaches a user plugin when it changes (an interactive /model raises
// no command.run, and cc-plugin-sec-default keeps classic.PostModelSwitch from user-tier plugins)
// Writes only when the rows would change (the timer shows minutes), except while a Clean View card works:
// its seconds timer reads the clock and redraws on this write when nothing on it animates
async function tick($: EngineInterface) {
  const [usage, now, model, prev, isOn, c] = await Promise.all([
    $.session.usage(), $.clock.now(), $.session.model(), read($, figures), read($, cleanView), read($, checklist),
  ])
  const live = {
    model,
    percent: usage.context.percent ?? 0,
    tokensIn: usage.context.tokens ?? 0,
    usd: usage.cost?.usd ?? 0,
    ms: now - usage.startedAt,
    quotas: quotas(usage.rateLimits),
  }
  const isTiming = isOn && c !== null && c.endedAt === undefined
  if (prev !== null && (isTiming || !sameRows(prev, { ...prev, ...live }))) {
    await update($, figures, f => f && { ...f, ...live })
  }
  if (isOn && c?.agents?.length) {
    const agents = await $.agent.list()
    await update($, agentStatus, prev => agentStatuses(prev, agents, (c.agents ?? []).map(a => a.id)))
  }
}
```

(The inner `prev` in the `agentStatus` updater shadows the outer one; rename the outer to `shown` if tsc or the linter flags it.)

- [ ] **Step 8: Run all tests, type check, validate**

Run: `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p . && claude plugin validate .`
Expected: all PASS, no tsc output.

- [ ] **Step 9: Changelog and commit**

`CHANGELOG.md`, under `## Unreleased` → `### Changed` (create the heading if Task 2 only added `### Fixed`; keep `### Changed` above `### Fixed`):

```markdown
- An idle session no longer redraws the status bar every second; it redraws when something on it changes (the
  timer once a minute). A working Clean View card still counts its seconds.
```

```bash
git add hooks/format.ts hooks/format.test.ts hooks/register.tsx hooks/register.test.tsx CHANGELOG.md
git commit -m "perf: skip the 1s status bar write when the rows would draw the same"
```

---

### Task 4: The picker also lists models from `modelSettings`

`settings.modelSettings` is keyed by full model id (e.g. `claude-opus-5-5`, `claude-fable-5-1` today). Fixed `MODELS` stay first; any other Claude id found there is appended, labeled by `prettyModel`. A discovered id is switched with `/model <id>`: `/config`'s Model row takes only a family alias, and `opus` would pick the newest Opus, not the id clicked.

**Files:**
- Modify: `hooks/format.ts` (`EffortSettings` export, `pickerModels`, `MODELS` comment)
- Modify: `hooks/format.test.ts`
- Modify: `hooks/register.tsx` (`refresh` stores `models`; picker maps `f.models`; `pickModel` fast path only for fixed models)
- Modify: `hooks/register.test.tsx`
- Modify: `types/index.d.ts` (`StatusFigures.models?`)
- Modify: `README.md` (picker section), `CHANGELOG.md`

**Interfaces:**
- Consumes: `MODELS`, `family`, `prettyModel`, `sameModel`; Task 1's harness (`w.modelSettings`, `w.commands`, `STATUSBAR`, `BAND`).
- Produces:
  - `export type PickerModel = { id: string; label: string }`
  - `export const pickerModels: (settings: EffortSettings) => PickerModel[]`
  - `StatusFigures.models?: { id: string; label: string }[]`

- [ ] **Step 1: Write the failing pure test**

Add `pickerModels` to the `./format` import in `hooks/format.test.ts` and append to `'statusbar rows'`:

```ts
  test('the picker adds models from modelSettings after the fixed ones, once each', async () => {
    const ids = (s: Parameters<typeof pickerModels>[0]) => pickerModels(s).map(m => m.label)
    expect(ids({})).toEqual(['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'])
    expect(ids({ modelSettings: { 'claude-opus-5-5': {}, 'claude-opus-4-1': {}, default: {}, opus: {}, 'gpt-5': {} } }))
      .toEqual(['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1', 'Opus 4.1'])
    expect(pickerModels({ modelSettings: { 'claude-opus-4-1': {} } }).at(-1)).toEqual({ id: 'claude-opus-4-1', label: 'Opus 4.1' })
  })

  test('the picker row stays short: at most 6 models', async () => {
    const many = Object.fromEntries(['1-0', '2-0', '3-0', '3-5'].map(v => [`claude-opus-${v}`, {}]))
    expect(pickerModels({ modelSettings: many })).toHaveLength(6)
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `claude plugin test .`
Expected: FAIL — `pickerModels` is not exported.

- [ ] **Step 3: Implement `pickerModels`**

In `hooks/format.ts`, change the `MODELS` comment and export the settings type:

```ts
// The models every picker shows; pickerModels adds the ones the person has used (modelSettings)
export const MODELS = [
```

```ts
export type EffortSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }
```

After `defaultEffort`:

```ts
export type PickerModel = { id: string; label: string }

// ponytail: 6 fit one picker row at 120 columns; a wider list would need a second row
const PICKER_MAX = 6

// /effort saves a level per model id in modelSettings: any Claude id there is one the person has used.
// Aliases (opus), 'default' and other vendors' ids have no claude-<family>-<n> and are left out
export const pickerModels = (settings: EffortSettings): PickerModel[] => {
  const found: PickerModel[] = [...MODELS]
  for (const id of Object.keys(settings.modelSettings ?? {})) {
    if (family(id) && !found.some(m => sameModel(m.id, id))) found.push({ id, label: prettyModel(id) })
  }
  return found.slice(0, PICKER_MAX)
}
```

- [ ] **Step 4: Run it**

Run: `claude plugin test .`
Expected: PASS.

- [ ] **Step 5: Write the failing hook tests**

Append to `hooks/register.test.tsx`:

```tsx
describe('the model picker', () => {
  test('lists a model from modelSettings and switches to that exact id with /model', async ($, on) => {
    const w = fresh({ modelSettings: { 'claude-opus-4-1': { effortLevel: 'high' } } })
    world(on, w)
    await start($)
    await $.command.run(STATUSBAR)
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Button', text: 'Opus 4.1' })).toBeDefined()
    await ui.press({ key: 'model-claude-opus-4-1' })
    expect(w.commands).toContain('model claude-opus-4-1')
    await ui.unmount()
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `claude plugin test .`
Expected: FAIL — no `Opus 4.1` button.

- [ ] **Step 7: Wire it**

`types/index.d.ts`, in `StatusFigures` after `quotas`:

```ts
  /** The picker's models: the fixed list, then ids from modelSettings. */
  models?: { id: string; label: string }[]
```

`hooks/register.tsx`:
1. In the `./format` import, add `pickerModels`; keep `MODELS` (used in step 3 below).
2. In `refresh()`'s returned object (Task 2's version), after `quotas`:

```ts
      models: pickerModels(settings as Parameters<typeof pickerModels>[0]),
```

3. In `pickModel` (around line 375), only the fixed models take the `/config` alias fast path:

```ts
    const pickModel = async (id: string) => {
      // /config's Model row takes a family alias, which means that family's newest model: right for the fixed list only
      const alias = MODELS.some(m => m.id === id) ? family(id) : undefined
```

4. In the picker's MODEL row (around line 394), map the figures' list:

```tsx
            {(f.models ?? MODELS).map(m => option(`model-${m.id}`, m.label,
```

- [ ] **Step 8: Run all tests, type check, validate**

Run: `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p . && claude plugin validate .`
Expected: all PASS, no tsc output.

- [ ] **Step 9: Docs and commit**

`README.md`: in the picker section, after the sentence that lists the models, add:

```markdown
Models you have set an effort for with `/effort` (saved in `modelSettings`) are added after these, up to 6 in all,
so a new model shows up once you have used it.
```

`CHANGELOG.md`, under `## Unreleased` → `### Changed`:

```markdown
- The picker also lists models you have used (those with an effort saved in `modelSettings`), so a new model no
  longer waits for a statusbar release. They switch with `/model <id>`, so an older Opus stays that Opus.
```

```bash
git add hooks/format.ts hooks/format.test.ts hooks/register.tsx hooks/register.test.tsx types/index.d.ts README.md CHANGELOG.md
git commit -m "feat: picker lists models from modelSettings after the fixed ones"
```

---

## After the last task

- [ ] `claude plugin test . && npx -y -p typescript@5.6.3 tsc -p . && claude plugin validate .` — all green.
- [ ] Manual check in a real session (`/reload-plugins`): row 1 shows `?N` in a repo with an untracked file; `git checkout --detach` shows `🌿 (sha)`; the picker opens with `⚙ Command`.
- [ ] Open a PR against `main` (superpowers:finishing-a-development-branch).
