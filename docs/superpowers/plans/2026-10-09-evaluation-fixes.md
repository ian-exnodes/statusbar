# Evaluation Fixes (0.9.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the findings from an outside evaluation of the plugin that are worth fixing. Ship them as 0.9.1.

**Architecture:** Small, separate fixes to the existing files. Pure logic stays in `hooks/clean.ts` / `hooks/format.ts` with unit tests. Wiring stays in `hooks/register.tsx`. Docs go in `README.md` / `CHANGELOG.md`. One new file is a GitHub Actions workflow.

**Tech Stack:** A TypeScript/TSX Claude Code plugin using function hooks (`claude-code` module). Tests use `claude-code/testing`, run by `claude plugin test .`. CI runs on GitHub Actions.

**Spec:** There's no design doc. The source is the evaluation the person pasted on 2026-10-09, summarized here with the decision for each finding:

| # | Finding | Decision |
|---|---|---|
| 1 | No LICENSE file | **Fix.** Add MIT (Task 1). The person confirms the license choice at plan review. |
| 2 | Clean View hides auto-approved Bash commands and edits | **Document.** Hiding them is the feature. Add a plain "What you don't see" note to the README (Task 6). Any design change gets its own brainstorm. |
| 3 | Checklist tool is registered when Clean View is off, says "Checklist shown" when it isn't, and costs tokens | **Fix** (Task 2) |
| 4 | `isFinalAnswer` substring match leaks intermediate notes | **Fix** (Task 3). `trailFor` has the same problem (a prefix match), so fix it too. |
| 5 | Hardcoded `MODELS` | **Skip.** There's no API that lists models. The code already comments this. |
| 6 | `tick()` updates `figures` every second | **Comment only** (Task 4). The per-second update is what redraws the Clean View card's seconds timer while no task is in progress (the animator only runs while a task or agent is moving). Gating it would freeze `Working… 12s`. |
| 7 | Cost / `↓` are approximations | **Skip.** The README already says so. |
| 8a | Row-1 `<Text>` in a map has no `key` | **Fix** (Task 4) |
| 8b | `effortFromCommand` matches "cancel" anywhere | **Fix** (Task 4). Match the word `cancelled`/`canceled`, not any "cancel". The real cancel text is `Effort change cancelled`, so anchoring to the start would break it. |
| 8c | No CI | **Fix** (Task 5). Checked 2026-10-09: `claude plugin test .` passes in a fresh clone with an empty `HOME` and no API key, so CI needs no secrets. |

## Global Constraints

- Version after this plan: `0.9.1` in `.claude-plugin/plugin.json`
- Branch: `fix/evaluation-findings`, already created from `main` (this plan is its first commit). One commit per task. Open a PR at the end; don't merge it.
- Test command: `claude plugin test .` (all must pass). Validate: `claude plugin validate .`. Types: `npx -y -p typescript tsc -p . --noEmit`.
- Validator rules for `register.tsx`:
  - A function that receives `$` must be declared at the top level of the file.
  - A `<Button>` with `hover` sits inside a keyed `<Box>`.
  - A `ui.render` hook never returns `null` (use the existing `empty($, e)`).
- Tool name stays `mcp__statusbar__checklist` (`CHECKLIST_TOOL`). `CLEAN_VIEW_NOTE` doesn't change.
- Comment style: short, plain sentences, about as sparse as the surrounding code. Deliberate shortcuts get a `ponytail:` comment.
- Claude Code floor stays `2.1.290`. CI pins `@anthropic-ai/claude-code@2.1.295`.
- Leave the untracked `ocean-facts/` folder alone; it isn't part of this work.

## Review Focus

1. **Clean View already on at session start:** the checklist tool must be in Claude's tool list from the first prompt, with no ToolSearch (the 0.9.0 behavior must not regress). Task 7, check 2.
2. **Clean View turned on mid-session from the picker:** the tool must be callable at the next prompt and fill the card. Task 7, check 3.
3. **Clean View turned off mid-session:** the tool is still listed (there's no unregister API), but a call must change nothing and return the "Not shown" text. Unit test in Task 2, live check in Task 7 (check 4).
4. **Real final answers with headings, nested indented lists and code fences must still show in full** under the stricter whole-line match. Unit tests in Task 3 (indented line, multi-line block), live check in Task 7 (check 5).
5. **A resumed session's earlier answers** (from `finalsFromMessages`) must still show. They go through the same `isFinalAnswer`. Unit test in Task 3, live check in Task 7 (check 6).

---

### Task 1: License

**Files:**
- Create: `LICENSE`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:** none.

- [ ] **Step 1: Be on the branch**

```bash
cd ~/statusbar && git checkout fix/evaluation-findings
```

- [ ] **Step 2: Write `LICENSE`** (standard MIT text, holder `ian-exnodes`, year 2026)

```text
MIT License

Copyright (c) 2026 ian-exnodes

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Add `"license": "MIT"` to `.claude-plugin/plugin.json`**, after `"author"`. The validator accepts this field (checked 2026-10-09).

- [ ] **Step 4: Validate.** Run `claude plugin validate .`. Expected: `✔ Validation passed`.

- [ ] **Step 5: Commit**

```bash
git add LICENSE .claude-plugin/plugin.json
git commit -m "chore: add MIT license"
```

---

### Task 2: Checklist tool only while Clean View is on, and a truthful reply

**Files:**
- Modify: `hooks/clean.ts` (add `checklistReply` right after `toolChecklist`)
- Modify: `hooks/register.tsx`: `setCleanView` (lines 27-31), the `session.start` tool registration (lines 234-256), the checklist `tool.call` hook (lines 430-437)
- Test: `hooks/clean.test.ts`

**Interfaces:**
- Produces: `checklistReply(isShown: boolean): string` in `hooks/clean.ts`, and the top-level `registerChecklist($: EngineInterface)` in `register.tsx`.

- [ ] **Step 1: Write the failing test.** Add `checklistReply` to the import list at the top of `hooks/clean.test.ts`, then add inside `describe('clean view', …)`:

```ts
  test('the checklist tool tells Claude whether the person saw the list', async () => {
    expect(checklistReply(true)).toBe('Checklist shown to the person.')
    expect(checklistReply(false)).toBe('Not shown: Clean View is off, or this call came from a helper agent. Carry on without this tool.')
  })
```

- [ ] **Step 2: Run it.** `claude plugin test .`. Expected: FAIL, because `checklistReply` is not exported.

- [ ] **Step 3: Implement in `hooks/clean.ts`**, right after `toolChecklist`:

```ts
// What the checklist tool answers Claude: only a list that reached the card was shown
export const checklistReply = (isShown: boolean) => isShown ? 'Checklist shown to the person.'
  : 'Not shown: Clean View is off, or this call came from a helper agent. Carry on without this tool.'
```

- [ ] **Step 4: Run it.** `claude plugin test .`. Expected: all pass.

- [ ] **Step 5: Wire it in `hooks/register.tsx`**

Add `checklistReply` to the `./clean` import. Add a top-level function above `setCleanView`, moving the tool spec out of `session.start` unchanged:

```tsx
// The tool Claude sends its plan to (CHECKLIST_TOOL); registered only while Clean View is on
const registerChecklist = ($: EngineInterface) => $.tool.register({
  name: 'checklist',
  description: "Shows the person your plan as a checklist while Clean View is on. Send the whole list each call.",
  // In the prompt's tool list, so Claude calls it without a ToolSearch first
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'A plain-language step, under 50 characters' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['subject', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
})
```

Replace `setCleanView` with:

```tsx
// Kept across sessions in the plugin's store; loadCleanView reads it back at session start
const setCleanView = async ($: EngineInterface, isOn: boolean) => {
  await update($, cleanView, () => isOn)
  await $.store.set('cleanView', isOn)
  // ponytail: no API removes a tool, so one turned off mid-session stays listed until the next session
  // (its calls then answer "Not shown")
  if (isOn) await registerChecklist($)
}
```

`registerChecklist` must be declared above `setCleanView`: it's a `const`, so it isn't hoisted. In `session.start`, replace the whole `await $.tool.register({ … })` block with:

```tsx
    if (await read($, cleanView)) await registerChecklist($)
```

It stays after `await loadCleanView($)`, which sets `cleanView` from the store.

Replace the checklist `tool.call` hook body:

```tsx
  on('tool.call', { tool: 'mcp__statusbar__checklist' as never }, async ($, e: { agentId?: string }) => {
    const isShown = e.agentId === undefined && (await read($, cleanView)) && (await read($, checklist)) !== null
    if (isShown) await update($, checklist, c => c && toolChecklist(c, e))
    const text = checklistReply(isShown)
    return { result: text, text }
  })
```

- [ ] **Step 6: Check.** Run `claude plugin test .`, `claude plugin validate .`, and `npx -y -p typescript tsc -p . --noEmit`. Expected: all pass, with no type errors. The validator's call list still shows `$.tool.register`.

- [ ] **Step 7: Commit**

```bash
git add hooks/clean.ts hooks/clean.test.ts hooks/register.tsx
git commit -m "fix: register the checklist tool only while Clean View is on; say when a list was not shown"
```

---

### Task 3: Final answers match whole lines, not any substring

**Files:**
- Modify: `hooks/clean.ts`: `isFinalAnswer` (around line 196) and `trailFor` (around line 144)
- Test: `hooks/clean.test.ts`: the tests `'a final answer shows, block by block; other notes do not'` (around line 77) and `'a trail line sums up each finished request above its answer'` (around line 269)

**Interfaces:**
- Consumes: `addFinal`, `finalsFromMessages` (existing, unchanged)
- Produces: same signatures: `isFinalAnswer(text: string, finals: readonly string[]): boolean`, `trailFor(text: string, trails: readonly Trail[]): string | undefined`

- [ ] **Step 1: Write the failing tests.** Append to `'a final answer shows, block by block; other notes do not'`:

```ts
    // A note that is only part of a line of an answer stays hidden
    expect(isFinalAnswer('Done.', finals)).toBe(false)
    expect(isFinalAnswer('dashboard', finals)).toBe(false)
    // Blocks the terminal draws on their own: an indented list item, a code fence over several lines
    const rich = addFinal([], '## Steps\n\n1. Install:\n   - run `npm i`\n\n```bash\nnpm test\nnpm run build\n```')
    expect(isFinalAnswer('- run `npm i`', rich)).toBe(true)
    expect(isFinalAnswer('```bash\nnpm test\nnpm run build\n```', rich)).toBe(true)
    expect(isFinalAnswer('## Steps', rich)).toBe(true)
    // A resumed session's answers come back through finalsFromMessages and still show
    const resumed = finalsFromMessages([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello.\n\nHow can I help?' }])
    expect(isFinalAnswer('How can I help?', resumed)).toBe(true)
```

Append to `'a trail line sums up each finished request above its answer'`:

```ts
    // Only a whole first line or block, not a word that starts it
    expect(trailFor('First', trails)).toBeUndefined()
```

- [ ] **Step 2: Run them.** `claude plugin test .`. Expected: FAIL on `isFinalAnswer('Done.', finals)` (returns true today) and `trailFor('First', trails)` (returns `'L1'` today).

- [ ] **Step 3: Implement in `hooks/clean.ts`.** Add the helper above `trailFor`:

```ts
// The block at i fills its lines of f: nothing but spaces before it on its first line or after it on its last
const fillsLines = (f: string, i: number, block: string) => {
  const end = i + block.length
  const lineEnd = f.indexOf('\n', end)
  return !f.slice(f.lastIndexOf('\n', i - 1) + 1, i).trim() && !f.slice(end, lineEnd < 0 ? f.length : lineEnd).trim()
}
```

Replace `trailFor`:

```ts
export const trailFor = (text: string, trails: readonly Trail[]) => {
  const block = text.trim()
  return block ? trails.find(t => {
    const answer = t.answer.trimStart()
    return answer.startsWith(block) && fillsLines(answer, 0, block)
  })?.line : undefined
}
```

Replace `isFinalAnswer` and its comment:

```ts
// A block of a final answer, not only the whole: the terminal draws a reply in blocks and hides some parts.
// Whole lines only, so a note that is part of a line of an answer ("Done.") stays hidden
export const isFinalAnswer = (text: string, finals: readonly string[]) => {
  const block = text.trim()
  return block.length > 0 && finals.some(f => {
    for (let i = f.indexOf(block); i >= 0; i = f.indexOf(block, i + 1)) if (fillsLines(f, i, block)) return true
    return false
  })
}
```

Note: `f.lastIndexOf('\n', -1)` (when `i` is 0) is treated as index 0. It returns -1 because `f[0]` is the block's first character, not `\n`, so the slice is empty, which is correct.

- [ ] **Step 4: Run them.** `claude plugin test .`. Expected: all pass, including the original block-by-block checks.

- [ ] **Step 5: Commit**

```bash
git add hooks/clean.ts hooks/clean.test.ts
git commit -m "fix: Clean View shows a block only when it fills whole lines of a final answer"
```

---

### Task 4: Small fixes: the effort cancel match, row keys, the tick comment

**Files:**
- Modify: `hooks/format.ts:56-58` (`effortFromCommand`)
- Modify: `hooks/register.tsx`, the `PromptHint` render (around line 313) and the `tick` comment (around lines 197-199)
- Test: `hooks/format.test.ts`, the test `'/effort is recorded only when Claude Code applied it'` (around line 144)

**Interfaces:** `effortFromCommand(args: string, output: string): StatusEffort | undefined` keeps the same signature.

- [ ] **Step 1: Write the failing test.** Append to `'/effort is recorded only when Claude Code applied it'`:

```ts
    expect(effortFromCommand('max', 'Effort change canceled')).toBeUndefined()
    // "cancel" elsewhere in a success message is not a cancel
    expect(effortFromCommand('low', 'Set effort level to low (press Esc to cancel a turn)')).toBe('low')
```

- [ ] **Step 2: Run it.** `claude plugin test .`. Expected: FAIL on the second line (returns undefined today).

- [ ] **Step 3: Implement** in `hooks/format.ts`:

```ts
// After /effort ran: a cancelled confirm reads "Kept …" (as /model's does) or "… cancelled" and changed nothing
export const effortFromCommand = (args: string, output: string) =>
  /^Kept\b|\bcancell?ed\b/i.test(output.trim()) ? undefined : parseEffort(args)
```

- [ ] **Step 4: Run it.** `claude plugin test .`. Expected: all pass.

- [ ] **Step 5: Add keys to row segments** in the `PromptHint` render of `hooks/register.tsx`:

```tsx
            {row.map((s, j) => s.isPicker
              ? <Button key="picker" label={s.text} onPress={() => void togglePicker($)} />
              : <Text key={`seg${j}`} color={s.color}>{s.text}</Text>)}
```

- [ ] **Step 6: Comment why `tick` updates every second.** Append this line to the comment block above `async function tick` in `hooks/register.tsx`:

```tsx
// ponytail: updates every second on purpose: the Clean View card's seconds timer redraws with it while nothing animates
```

- [ ] **Step 7: Check.** Run `claude plugin test .`, `claude plugin validate .`, and `npx -y -p typescript tsc -p . --noEmit`. Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add hooks/format.ts hooks/format.test.ts hooks/register.tsx
git commit -m "fix: /effort cancel matches the word only; keys on status row segments"
```

---

### Task 5: CI

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md`, the `## Develop` section

**Interfaces:** none.

- [ ] **Step 1: Write `.github/workflows/test.yml`**

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      DISABLE_AUTOUPDATER: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The plugin's tests run on Claude Code's own test runner; no login or API key is needed
      - run: npm install -g @anthropic-ai/claude-code@2.1.295
      - run: claude plugin validate .
      - run: claude plugin test .
```

- [ ] **Step 2: Add one line under the `## Develop` code block in `README.md`**, before the `.claude-plugin/types/` line:

```markdown
GitHub Actions runs `validate` and `test` on each push to `main` and each pull request (`.github/workflows/test.yml`).
```

- [ ] **Step 3: Commit and push the branch**

```bash
git add .github/workflows/test.yml README.md
git commit -m "ci: validate and test the plugin on GitHub Actions"
git push -u origin fix/evaluation-findings
```

- [ ] **Step 4: Run the workflow and watch it.** A `pull_request` trigger needs a PR, so open it as a draft now (Task 7 marks it ready):

```bash
gh pr create --draft --base main --head fix/evaluation-findings --title "fix: evaluation findings (0.9.1)" --body "Draft; description filled in at the end."
gh run watch $(gh run list --branch fix/evaluation-findings --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

Expected: `validate` passes and `test` reports all pass.
  - If only `claude plugin test .` fails on Linux (the plugin is tested on macOS only), change `runs-on: ubuntu-latest` to `runs-on: macos-latest`, then commit `ci: run on macOS`, push, and watch again.
  - If `npm install` fails because that version isn't on npm, use the version `npm view @anthropic-ai/claude-code version` prints. It must be ≥ 2.1.290.

---

### Task 6: Docs and version

**Files:**
- Modify: `README.md` (Clean View section, `## What it runs`, new `## License`)
- Modify: `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json` (version)

**Interfaces:** none.

- [ ] **Step 1: README, Clean View.** After the paragraph that ends "turn Clean View off and every hidden row shows again.", add:

```markdown
**What you don't see.** Commands and file edits that your permission settings allow without asking run with no row
on screen; only permission prompts reach you. Until you click `[ Details ]`, the trace is the card's activity line
(`Running a command…`, `Editing register.tsx…`) and the files-changed count. If you rely on watching each command,
for example with bypass permissions or broad allow rules, keep Clean View off or open Details.
```

- [ ] **Step 2: README, `## What it runs`.** Replace the `**A tool for Claude:**` bullet with:

```markdown
- **A tool for Claude:** while Clean View is on, the session gets one tool from this plugin, `mcp__statusbar__checklist`, which Claude uses to send its plan to the Clean View card. It only reads the list it is given. It sits in Claude's tool list from the start, which adds its short description to each request. With Clean View off at session start it is not registered at all; turned off mid-session, it stays listed until the next session and answers Claude that the list was not shown.
```

- [ ] **Step 3: README, add a `## License` section at the end**

```markdown
## License

MIT. See [LICENSE](LICENSE).
```

- [ ] **Step 4: CHANGELOG.** Insert above `## 0.9.0 (2026-10-08)`, using the same section order as 0.9.0:

```markdown
## 0.9.1 (2026-10-09)

### Added

- MIT license.
- CI: GitHub Actions validates and tests the plugin on each push and pull request.

### Changed

- The checklist tool is registered only while Clean View is on, so a session without it carries no extra tool.
  Turned off mid-session, the tool tells Claude its list was not shown instead of claiming it was.

### Fixed

- A note of Claude's that happened to be part of a line of a recent answer could show through Clean View. Hidden
  rows now show only when they fill whole lines of a final answer.
- `/effort` output with "cancel" anywhere in it was read as a cancel.
```

- [ ] **Step 5: Bump the version.** In `.claude-plugin/plugin.json`, change `"version": "0.9.0"` to `"version": "0.9.1"`.

- [ ] **Step 6: Check.** Run `claude plugin validate .` and `claude plugin test .`. Expected: both pass.

- [ ] **Step 7: Commit and push**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "docs: what Clean View hides, the checklist tool, license; 0.9.1"
git push
```

---

### Task 7: Live checks and the PR

**Files:** none changed. If a check fails, fix it in the task that owns the code, then re-run the check.

Run each check in a fresh `claude --plugin-dir ~/statusbar` session (or `/reload-plugins`). Clean View is switched in the picker (`⚙ Command` → `CLEAN VIEW Off/On`). The person's stored Clean View value is `true`; leave it `true` at the end.

- [ ] **Check 1 (off at start, tool absent):** Clean View Off, then start a new session. Ask: "List any tool whose name starts with mcp__statusbar." Expected: Claude names none and doesn't find one through ToolSearch.
- [ ] **Check 2 (on at start, Review Focus 1):** Clean View On, then start a new session. Ask: "Run `ls` and tell me how many entries." Expected: the card fills from the checklist tool, and Claude makes no ToolSearch call before it (confirm with `[ Details ]`).
- [ ] **Check 3 (turned on mid-session, Review Focus 2):** Start with Clean View Off, turn it On in the picker, then send the same prompt as check 2. Expected: the card fills at that prompt.
- [ ] **Check 4 (turned off mid-session, Review Focus 3):** Continuing from check 3, turn Clean View Off. Ask: "Call mcp__statusbar__checklist with one task 'test', then tell me exactly what it returned." Expected: Claude quotes `Not shown: Clean View is off, or this call came from a helper agent. Carry on without this tool.`, and no card appears.
- [ ] **Check 5 (rich answers, Review Focus 4):** Clean View On. Ask: "Answer with a `## Steps` heading, a numbered list with an indented sub-bullet, and a bash code block of two lines." Expected: the whole answer shows. The in-between notes are still hidden until `[ Details ]`.
- [ ] **Check 6 (resume, Review Focus 5):** `/exit`, then `claude --plugin-dir ~/statusbar --resume` and pick the session from check 5. Expected: its final answer shows in full with Clean View On.
- [ ] **Step 7: Fill in the PR and mark it ready** (don't merge):

```bash
gh pr edit --title "fix: evaluation findings (0.9.1): license, checklist tool only with Clean View, whole-line answer match, CI" \
  --body "$(cat <<'EOF'
Fixes from an outside evaluation:

- MIT license
- Checklist tool registered only while Clean View is on; truthful reply when the list was not shown
- Final answers matched on whole lines, so a note that is part of an answer line no longer shows through Clean View (same fix for trail lines)
- /effort cancel matched as a word; keys on status row segments; comment on why tick updates every second
- CI on GitHub Actions (validate + test)
- README: what Clean View hides
- 0.9.1

Skipped on purpose: the hardcoded model list (no API lists models), and the cost/↓ approximations (already disclosed in the README).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr ready
```
