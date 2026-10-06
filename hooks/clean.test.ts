import { describe, expect, test } from 'claude-code/testing'

import {
  CLEAN_VIEW_NOTE, addFinal, card, elapsed, isFinalAnswer, shortTitle, startChecklist, taskCreated, taskUpdated, todosWritten, toolChecklist, turnEnded, withCleanViewNote,
  finalsFromMessages, revealsNotes, startsCard, turnOutcome,
  agentSpawned, agentsSummary, reopened,
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

  test('a continuation turn with no typed text keeps the card', async () => {
    expect(startsCard('Build the page')).toBe(true)
    expect(startsCard('   ')).toBe(false)
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

  test('agents are summed up: running, done, failed', async () => {
    expect(agentsSummary([])).toBeUndefined()
    expect(agentsSummary(['running'])?.text).toBe('1 agent: running')
    expect(agentsSummary(['completed', 'idle', 'waiting'])?.text).toBe('3 agents: 2 done, 1 running')
    expect(agentsSummary(['completed', 'completed'])?.text).toBe('2 agents: done')
    const failed = agentsSummary(['completed', 'failed', 'killed', 'pending'])
    expect(failed?.text).toBe('4 agents: 1 done, 1 running, 2 failed')
    expect(failed?.hasFailed).toBe(true)
    expect(failed?.running).toBe(1)
  })

  test('a spawned agent joins the card once', async () => {
    const c = agentSpawned(agentSpawned(four, 'a1'), 'a1')
    expect(agentSpawned(c, 'a2').agentIds).toEqual(['a1', 'a2'])
  })

  test('the agent line sits under the working task, or under the title without one', async () => {
    const working = taskUpdated(four, { taskId: 't1', status: 'in_progress' })
    const k = card(working, 0, 'blue', ['running', 'completed'])
    expect(k.agents).toEqual({ text: '2 agents: 1 done, 1 running', hasFailed: false, afterRow: 1 })
    expect(card(start, 0, 'blue', ['running']).agents?.afterRow).toBeUndefined()
    expect(card(four, 0, 'blue').agents).toBeUndefined()
  })

  test('a card closed while agents still run says so; a continuation re-opens it', async () => {
    const all = four.tasks.reduce((c, t) => taskUpdated(c, { taskId: t.id, status: 'completed' }), four)
    const closed = turnEnded(all, 192_000, 'answer')
    expect(card(closed, 0, 'blue', ['running', 'completed']).footer).toBe('✓ 4 of 4 done · 3m · 1 agent still running')
    expect(card(closed, 0, 'blue', ['completed']).footer).toBe('✓ 4 of 4 done · 3m')
    const open = reopened(closed)
    expect(open.endedAt).toBeUndefined()
    expect(open.outcome).toBeUndefined()
    expect(card(open, 200_000, 'blue').footer).toBeUndefined()
  })

  test('only the last 50 final answers are kept', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `answer ${i}`).reduce(addFinal, [] as string[])
    expect(many.length).toBe(50)
    expect(many[0]).toBe('answer 10')
  })
})
