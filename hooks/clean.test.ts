import { describe, expect, test } from 'claude-code/testing'

import {
  CLEAN_VIEW_NOTE, addFinal, card, elapsed, isFinalAnswer, shortTitle, startChecklist, taskCreated, taskUpdated, todosWritten, toolChecklist, turnEnded, withCleanViewNote,
  finalsFromMessages, revealsNotes, startsCard, turnOutcome,
  agentSpawned, reopened, shimmer, SPINNER, TASK_CELLS,
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
    expect(k.rows.map(r => `${r.mark} ${r.label}`)).toEqual(['✓ Done', `${SPINNER[0]} Working`, '○ Next', '○ Up next'])
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

  test('the planning note rides along with the prompt, once', async () => {
    expect(withCleanViewNote(undefined)).toEqual([CLEAN_VIEW_NOTE])
    expect(withCleanViewNote(['other note'])).toEqual(['other note', CLEAN_VIEW_NOTE])
    expect(withCleanViewNote([CLEAN_VIEW_NOTE])).toEqual([CLEAN_VIEW_NOTE])
    expect(CLEAN_VIEW_NOTE).toContain('mcp__statusbar__checklist')
    expect(CLEAN_VIEW_NOTE).toContain('select:mcp__statusbar__checklist')
    expect(CLEAN_VIEW_NOTE).toContain('before writing your final answer')
  })

  test("the plugin's checklist tool replaces the list, skipping malformed entries", async () => {
    const c = toolChecklist(four, { tasks: [
      { subject: 'Read the files', status: 'completed' },
      { subject: 'Count the lines', status: 'in_progress' },
      { subject: 42, status: 'pending' },
      { subject: 'Report', status: 'later' },
      { subject: 'Report the counts' },
    ] })
    expect(c.tasks).toEqual([
      { id: 'todo-0', subject: 'Read the files', status: 'completed' },
      { id: 'todo-1', subject: 'Count the lines', status: 'in_progress' },
      { id: 'todo-2', subject: 'Report the counts', status: 'pending' },
    ])
    expect(toolChecklist(four, 'nonsense')).toEqual(four)
  })

  test("only the main conversation's turn closes the card", async () => {
    expect(turnOutcome({ reason: 'answer', isAborted: false })).toBe('answer')
    expect(turnOutcome({ reason: 'aborted', isAborted: true })).toBe('stopped')
    expect(turnOutcome({ reason: 'error', isAborted: false })).toBe('stopped')
    expect(turnOutcome({ reason: 'answer', isAborted: false, agentId: 'agent-7' })).toBeUndefined()
  })

  test('an error or refusal reveals what Claude wrote; an answer or Esc does not', async () => {
    expect(revealsNotes({ reason: 'error' })).toBe(true)
    expect(revealsNotes({ reason: 'refusal' })).toBe(true)
    expect(revealsNotes({ reason: 'answer' })).toBe(false)
    expect(revealsNotes({ reason: 'aborted' })).toBe(false)
  })

  test('only a prompt the person sent opens a card; agent reports and messages carry on the one there', async () => {
    expect(startsCard({ text: 'Build the page', origin: { kind: 'composer' } })).toBe(true)
    expect(startsCard({ text: 'Build the page', origin: { kind: 'bridge' } })).toBe(true)
    expect(startsCard({ text: '   ', origin: { kind: 'composer' } })).toBe(false)
    expect(startsCard({ text: '<task-notification>…', origin: { kind: 'task-notification' } })).toBe(false)
    expect(startsCard({ text: '<agent-message from="ac27">…', origin: { kind: 'unclassified' } })).toBe(false)
    expect(startsCard({ text: 'hi', origin: { kind: 'peer-send-message' } })).toBe(false)
    // Typed while Claude works: it joins the running turn, so the card of that turn goes on
    expect(startsCard({ text: 'also add tests', origin: { kind: 'composer' }, turnId: 'turn-1' })).toBe(false)
  })

  test("a resumed session's final answers come from its history", async () => {
    const history = [
      { role: 'user' as const, text: 'Count the lines' },
      { role: 'assistant' as const, text: 'Let me check.' },
      { role: 'user' as const, text: '', toolResults: [{}] },
      { role: 'assistant' as const, text: 'Both files have 3 lines.' },
      { role: 'user' as const, text: 'Thanks, now sort them' },
      { role: 'assistant' as const, text: '' },
      { role: 'user' as const, text: '', toolResults: [{}] },
      { role: 'assistant' as const, text: 'Sorted.' },
    ]
    expect(finalsFromMessages(history)).toEqual(['Both files have 3 lines.', 'Sorted.'])
  })

  test('the working task animates: its mark spins and a bar slides back and forth', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    expect(card(working, 0, 'blue', {}, 3).rows[1]?.mark).toBe(SPINNER[3])
    expect(card(working, 0, 'blue', {}, SPINNER.length).rows[1]?.mark).toBe(SPINNER[0])
    expect(shimmer(0)).toBe('▰▰▰▱▱▱▱▱▱▱▱▱')
    expect(shimmer(2)).toBe('▱▱▰▰▰▱▱▱▱▱▱▱')
    expect(shimmer(9)).toBe('▱▱▱▱▱▱▱▱▱▰▰▰')
    expect(shimmer(10)).toBe('▱▱▱▱▱▱▱▱▰▰▰▱')
    expect(shimmer(18)).toBe(shimmer(0))
    expect(shimmer(5).length).toBe(TASK_CELLS)
    // No agents under it: motion only, never a made-up %
    const group = card(working, 0, 'blue', {}, 2).rows[1]?.group
    expect(group).toEqual({ cells: shimmer(2), agents: [], more: 0 })
    expect(card(working, 0, 'blue').rows[0]?.group).toBeUndefined()
  })

  test('a spawned agent joins the card once, under the task in progress', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const c = agentSpawned(agentSpawned(working, 'a1', 'security review'), 'a1', 'security review')
    expect(c.agents).toEqual([{ id: 'a1', description: 'security review', taskId: 't1' }])
    expect(agentSpawned(four, 'a2', 'look around').agents).toEqual([{ id: 'a2', description: 'look around' }])
  })

  test('agents under a task: a row each and a real % of those finished', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const c = ['security review', 'performance review', 'test coverage review']
      .reduce((x, d, i) => agentSpawned(x, `a${i}`, d), working)
    const group = card(c, 0, 'blue', { a0: 'completed', a1: 'running' }, 1).rows[1]?.group
    expect(group?.label).toBe('1 of 3 · 33%')
    expect(group?.cells).toBe('▰▰▰▰▱▱▱▱▱▱▱▱')
    expect(group?.agents.map(a => `${a.mark} ${a.subject} ${a.label}`)).toEqual([
      '✓ security review Done', `${SPINNER[1]} performance review Running`, `${SPINNER[1]} test coverage review Running`,
    ])
    expect(group?.agents[0]?.color).toBe('green')
    expect(group?.agents[1]?.color).toBe('blue')
  })

  test('failed agents count as finished and show in red', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const c = ['one', 'two'].reduce((x, d, i) => agentSpawned(x, `a${i}`, d), working)
    const group = card(c, 0, 'blue', { a0: 'idle', a1: 'killed' }).rows[1]?.group
    expect(group?.label).toBe('2 of 2 · 100% · 1 failed')
    expect(group?.color).toBe('red')
    expect(group?.agents[1]).toEqual({ mark: '✗', subject: 'two', label: 'Failed', color: 'red' })
  })

  test('more than 5 agents: the rest are counted, not listed', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const c = Array.from({ length: 8 }, (_, i) => i).reduce((x, i) => agentSpawned(x, `a${i}`, `agent ${i}`), working)
    const group = card(c, 0, 'blue').rows[1]?.group
    expect(group?.agents.length).toBe(5)
    expect(group?.more).toBe(3)
    expect(group?.label).toBe('0 of 8 · 0%')
  })

  test('agents stay under a finished task while they still run; agents with no task sit under the title', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const c = taskUpdated(agentSpawned(working, 'a0', 'background check'), { taskId: 't1', status: 'completed' })
    expect(card(c, 0, 'blue', { a0: 'running' }).rows[1]?.group?.agents.length).toBe(1)
    expect(card(c, 0, 'blue', { a0: 'completed' }).rows[1]?.group).toBeUndefined()
    const loose = agentSpawned(start, 'a9', 'look around')
    expect(card(loose, 0, 'blue').group?.agents.map(a => a.subject)).toEqual(['look around'])
    expect(card(loose, 0, 'blue').footer).toBe('Working… 0s')
    expect(card(four, 0, 'blue').group).toBeUndefined()
  })

  test('a turn that ends while agents still run keeps the card open, waiting for them', async () => {
    const working = taskUpdated(taskUpdated(four, { taskId: 't0', status: 'completed' }), { taskId: 't1', status: 'in_progress' })
    const closed = turnEnded(['x', 'y', 'z'].reduce((c, d, i) => agentSpawned(c, `a${i}`, d), working), 12_000, 'answer')
    const waiting = card(closed, 0, 'blue', { a0: 'completed' }, 1)
    expect(waiting.footer).toBe('Waiting for 2 agents · 12s')
    expect(waiting.step).toBe('Step 2 of 4')
    expect(waiting.rows[1]?.group?.label).toBe('1 of 3 · 33%')
    expect(waiting.rows[1]?.group?.agents.map(a => a.label)).toEqual(['Done', 'Running', 'Running'])
    expect(card(closed, 0, 'blue', { a0: 'completed', a1: 'idle', a2: 'running' }).footer).toBe('Waiting for 1 agent · 12s')
  })

  test('once its agents finish, a closed card collapses to its done line; a continuation re-opens it', async () => {
    const all = four.tasks.reduce((c, t) => taskUpdated(c, { taskId: t.id, status: 'completed' }), four)
    const closed = turnEnded(agentSpawned(agentSpawned(all, 'a0', 'x'), 'a1', 'y'), 192_000, 'answer')
    expect(card(closed, 0, 'blue', { a0: 'completed', a1: 'idle' })).toEqual({ title: closed.title, filled: 0, rows: [], footer: '✓ 4 of 4 done · 3m' })
    expect(card(turnEnded(four, 5_000, 'stopped'), 0, 'blue').footer).toBe('Stopped · 0 of 4 done · 5s')
    const open = reopened(closed)
    expect(open.endedAt).toBeUndefined()
    expect(open.outcome).toBeUndefined()
    expect(card(open, 200_000, 'blue', { a0: 'completed', a1: 'idle' }).footer).toBeUndefined()
  })

  test('only the last 50 final answers are kept', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `answer ${i}`).reduce(addFinal, [] as string[])
    expect(many.length).toBe(50)
    expect(many[0]).toBe('answer 10')
  })
})
