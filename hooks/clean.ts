import type { CleanAgent, CleanChecklist, CleanTaskStatus } from '../types'

export const BAR_CELLS = 20
export const TASK_CELLS = 12
const AGENTS_SHOWN = 5
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
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

export type CardAgentRow = { mark: string; subject: string; label: string; color?: string }
// Under a task (or the title): a bar, a real % when agents report one, and an agent row each
export type CardGroup = { cells: string; label?: string; color?: string; agents: CardAgentRow[]; more: number }
export type CardRow = { mark: string; subject: string; label: string; color?: string; isBold?: true; isDim?: true; group?: CardGroup }
export type Card = { title: string; step?: string; filled: number; rows: CardRow[]; footer?: string; group?: CardGroup }

// Agent statuses as $.agent.list() reports them; one not listed yet has only just been spawned
const DONE = ['completed', 'idle']
const FAILED = ['failed', 'killed']
export const isRunning = (status: string | undefined) => !DONE.includes(status ?? '') && !FAILED.includes(status ?? '')

// The agent joins the task in progress when it starts, so parallel tasks keep their own agents
export const agentSpawned = (c: CleanChecklist, id: string, description: string): CleanChecklist => {
  if (c.agents?.some(a => a.id === id)) return c
  const taskId = c.tasks.find(t => t.status === 'in_progress')?.id
  return { ...c, agents: [...(c.agents ?? []), { id, description, ...(taskId ? { taskId } : {}) }] }
}

// Background agents reported back and Claude carries on with the same request
export const reopened = (c: CleanChecklist): CleanChecklist => {
  const { endedAt: _ended, outcome: _outcome, ...open } = c
  return open
}

// A block bouncing across the bar: motion that says "alive" without claiming a %
export const shimmer = (frame: number, block = 3) => {
  const span = TASK_CELLS - block
  const at = frame % (span * 2)
  const pos = at <= span ? at : span * 2 - at
  return Array.from({ length: TASK_CELLS }, (_, i) => i >= pos && i < pos + block ? '▰' : '▱').join('')
}

const agentGroup = (agents: readonly CleanAgent[], statusById: Readonly<Record<string, string>>, accent: string, spin: string): CardGroup => {
  const statuses = agents.map(a => statusById[a.id])
  const finished = statuses.filter(s => !isRunning(s)).length
  const failed = statuses.filter(s => FAILED.includes(s ?? '')).length
  const percent = Math.round((finished / agents.length) * 100)
  const filled = Math.round((finished / agents.length) * TASK_CELLS)
  return {
    cells: '▰'.repeat(filled) + '▱'.repeat(TASK_CELLS - filled),
    label: `${finished} of ${agents.length} · ${percent}%${failed ? ` · ${failed} failed` : ''}`,
    ...(failed ? { color: 'red' } : {}),
    agents: agents.slice(0, AGENTS_SHOWN).map((a, i): CardAgentRow =>
      FAILED.includes(statuses[i] ?? '') ? { mark: '✗', subject: a.description, label: 'Failed', color: 'red' }
        : isRunning(statuses[i]) ? { mark: spin, subject: a.description, label: 'Running', color: accent }
          : { mark: '✓', subject: a.description, label: 'Done', color: 'green' }),
    more: Math.max(0, agents.length - AGENTS_SHOWN),
  }
}

// What Claude is doing, in the person's words; undefined for bookkeeping calls, which keep the activity there
const QUIET = ['ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite']
export const activityOf = (tool: string, input: object): string | undefined => {
  const path = (input as { file_path?: unknown }).file_path
  if (QUIET.includes(tool) || tool.startsWith('mcp__statusbar__')) return undefined
  if (['Read', 'Grep', 'Glob', 'LSP'].includes(tool)) return 'Reading files…'
  if (['Edit', 'Write', 'NotebookEdit'].includes(tool)) {
    return typeof path === 'string' ? `Editing ${path.split('/').pop()}…` : 'Editing files…'
  }
  if (tool === 'Bash') return 'Running a command…'
  if (tool === 'Agent') return 'Starting helpers…'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Looking things up…'
  if (tool === 'AskUserQuestion') return 'Asking you a question…'
  const server = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1]
  return server ? `Using ${server}…` : 'Working…'
}

export const activitySet = (c: CleanChecklist, activity: string | undefined): CleanChecklist =>
  activity === undefined ? c : { ...c, activity }

export const fileChanged = (c: CleanChecklist, path: string): CleanChecklist =>
  c.files?.includes(path) ? c : { ...c, files: [...(c.files ?? []), path] }

const filesText = (c: CleanChecklist) =>
  c.files?.length ? ` · ${c.files.length} ${c.files.length === 1 ? 'file' : 'files'} changed` : ''

const countsText = (c: CleanChecklist) => {
  const done = c.tasks.filter(t => t.status === 'completed').length
  return c.tasks.length ? `${done} of ${c.tasks.length} done · ` : ''
}

// One dim line above the request's final answer, so scrolling back shows what each request did
export const trailLine = (c: CleanChecklist) => {
  const time = elapsed((c.endedAt ?? c.startedAt) - c.startedAt)
  return c.outcome === 'answer'
    ? `✓ ${c.title} · ${countsText(c)}${time}${filesText(c)}`
    : `Stopped · ${c.title} · ${countsText(c)}${time}${filesText(c)}`
}

export type Trail = { answer: string; line: string }
// The block at i fills its lines of f: nothing but spaces before it on its first line or after it on its last
const fillsLines = (f: string, i: number, block: string) => {
  const end = i + block.length
  const lineEnd = f.indexOf('\n', end)
  return !f.slice(f.lastIndexOf('\n', i - 1) + 1, i).trim() && !f.slice(end, lineEnd < 0 ? f.length : lineEnd).trim()
}

// Only above the answer's first block: the terminal draws a reply in blocks
export const trailFor = (text: string, trails: readonly Trail[]) => {
  const block = text.trim()
  return block ? trails.find(t => {
    const answer = t.answer.trimStart()
    return answer.startsWith(block) && fillsLines(answer, 0, block)
  })?.line : undefined
}

export const card = (
  c: CleanChecklist, now: number, accent: string, statusById: Readonly<Record<string, string>> = {}, frame = 0,
): Card => {
  const total = c.tasks.length
  const done = c.tasks.filter(t => t.status === 'completed').length
  const time = elapsed((c.endedAt ?? now) - c.startedAt)
  const counts = countsText(c)
  const agents = c.agents ?? []
  const spin = SPINNER[frame % SPINNER.length] ?? '●'

  // Background agents outlive the turn: the card stays open on them until they all finish, then collapses
  const running = agents.filter(a => isRunning(statusById[a.id])).length
  const isClosed = c.endedAt !== undefined
  if (isClosed && !running) {
    return { title: c.title, filled: 0, rows: [], footer: c.outcome === 'answer' ? `✓ ${counts || 'Done · '}${time}${filesText(c)}` : `Stopped · ${counts}${time}${filesText(c)}` }
  }
  const waiting = isClosed ? { footer: `Waiting for ${running} ${running === 1 ? 'agent' : 'agents'} · ${time}` } : {}

  const taskIds = new Set(c.tasks.map(t => t.id))
  const loose = agents.filter(a => a.taskId === undefined || !taskIds.has(a.taskId))
  const group = loose.length ? { group: agentGroup(loose, statusById, accent, spin) } : {}
  if (total === 0) return { title: c.title, filled: 0, rows: [], footer: `${c.activity ?? 'Working…'} ${time}`, ...group, ...waiting }

  const working = c.tasks.findIndex(t => t.status === 'in_progress')
  const next = c.tasks.findIndex((t, i) => t.status === 'pending' && i > working)
  const rows = c.tasks.map((t, i): CardRow => {
    const own = agents.filter(a => a.taskId === t.id)
    const isWorking = t.status === 'in_progress'
    const showsAgents = own.length > 0 && (isWorking || own.some(a => isRunning(statusById[a.id])))
    const taskGroup = showsAgents ? { group: agentGroup(own, statusById, accent, spin) }
      : isWorking ? { group: { cells: shimmer(frame), ...(c.activity ? { label: c.activity } : {}), agents: [], more: 0 } } : {}
    return t.status === 'completed' ? { mark: '✓', subject: t.subject, label: 'Done', color: 'green', ...taskGroup }
      : isWorking ? { mark: spin, subject: t.subject, label: 'Working', color: accent, isBold: true, ...taskGroup }
        : { mark: '○', subject: t.subject, label: i === next ? 'Next' : 'Up next', isDim: true }
  })

  return {
    title: c.title,
    step: `Step ${working >= 0 ? working + 1 : done} of ${total}`,
    filled: Math.round((done / total) * BAR_CELLS),
    rows,
    ...group,
    ...waiting,
  }
}

// A block of a final answer, not only the whole: the terminal draws a reply in blocks and hides some parts.
// Whole lines only, so a note that is part of a line of an answer ("Done.") stays hidden
export const isFinalAnswer = (text: string, finals: readonly string[]) => {
  const block = text.trim()
  return block.length > 0 && finals.some(f => {
    for (let i = f.indexOf(block); i >= 0; i = f.indexOf(block, i + 1)) if (fillsLines(f, i, block)) return true
    return false
  })
}

// Read by Claude beside each prompt while Clean View is on, never shown to the person. The plugin's own tool,
// because Claude Code's task tools (TaskCreate, TodoWrite) are present in some sessions and absent in others
export const CHECKLIST_TOOL = 'mcp__statusbar__checklist'
export const CLEAN_VIEW_NOTE = 'The person is using Clean View: they see a checklist of your steps, not your tool calls. '
  + `Before working on a request, call ${CHECKLIST_TOOL} with a few short tasks (subject: a plain-language step, `
  + 'under 50 characters; status pending, in_progress or completed). Call it again, with the whole list, whenever a '
  + 'task starts or finishes. Mark the last task completed before writing your final answer, and call no tools after '
  + 'it. For a quick question, one task is enough. If the tool is not loaded yet, load it first '
  + `with ToolSearch, query "select:${CHECKLIST_TOOL}".`

export const withCleanViewNote = (context: readonly string[] | undefined) =>
  context?.includes(CLEAN_VIEW_NOTE) ? [...context] : [...(context ?? []), CLEAN_VIEW_NOTE]

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

// The checklist tool's input comes from the model: keep the well-formed tasks, drop the rest
export const toolChecklist = (c: CleanChecklist, input: unknown): CleanChecklist => {
  const tasks = (input as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) return c
  const valid = tasks.flatMap(t => {
    const { subject, status = 'pending' } = (t ?? {}) as { subject?: unknown; status?: unknown }
    return typeof subject === 'string' && typeof status === 'string' && STATUSES.includes(status)
      ? [{ content: subject, status: status as CleanTaskStatus }] : []
  })
  return todosWritten(c, valid)
}

// What the checklist tool answers Claude: only a list that reached the card was shown
export const checklistReply = (isShown: boolean) => isShown ? 'Checklist shown to the person.'
  : 'Not shown: Clean View is off, or this call came from a helper agent. Carry on without this tool.'

// A subagent's turn is not the person's request: it neither closes the card nor counts as a final answer
export const turnOutcome = (e: { reason: string; isAborted: boolean; agentId?: string }) =>
  e.agentId !== undefined ? undefined : e.reason === 'answer' && !e.isAborted ? 'answer' as const : 'stopped' as const

// After an error or refusal the person needs to see why Claude stopped; Esc is their own choice
export const revealsNotes = (e: { reason: string }) => e.reason === 'error' || e.reason === 'refusal'

// Only the person's own prompt opens a card. Agent reports, agent messages and other deliveries start turns too
// (their text is engine-made, like <task-notification>), and they carry on the request already on the card.
// A prompt typed mid-turn (turnId set) joins the running turn, so its card goes on as well.
const PERSON = ['composer', 'bridge']
export const startsCard = (e: { text: string; origin: { kind: string }; turnId?: string }) =>
  PERSON.includes(e.origin.kind) && e.turnId === undefined && e.text.trim().length > 0

type HistoryMessage = { role: 'user' | 'assistant'; text: string; toolResults?: readonly unknown[] }

// A resumed session's final answers: the last assistant text before each prompt the person typed
export const finalsFromMessages = (messages: readonly HistoryMessage[]) => {
  const finals: string[] = []
  let last: string | undefined
  for (const m of messages) {
    const isPrompt = m.role === 'user' && !m.toolResults?.length && m.text.trim() !== ''
    if (isPrompt) {
      if (last !== undefined) finals.push(last)
      last = undefined
    } else if (m.role === 'assistant' && m.text.trim() !== '') last = m.text
  }
  if (last !== undefined) finals.push(last)
  return finals.slice(-FINALS_KEPT)
}

export const addFinal = (finals: readonly string[], answer: string) => [...finals, answer].slice(-FINALS_KEPT)
