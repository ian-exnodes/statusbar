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
export type CardAgents = { text: string; hasFailed: boolean; afterRow?: number }
export type Card = { title: string; step?: string; filled: number; rows: CardRow[]; footer?: string; agents?: CardAgents }

const RUNNING = ['pending', 'running', 'waiting']
const FAILED = ['failed', 'killed']

// Agent statuses as $.agent.list() reports them; done covers completed and idle
export const agentsSummary = (statuses: readonly string[]) => {
  if (statuses.length === 0) return undefined
  const running = statuses.filter(s => RUNNING.includes(s)).length
  const failed = statuses.filter(s => FAILED.includes(s)).length
  const done = statuses.length - running - failed
  const noun = statuses.length === 1 ? 'agent' : 'agents'
  const parts = [done && `${done} done`, running && `${running} running`, failed && `${failed} failed`].filter(Boolean)
  const detail = parts.length === 1 ? String(parts[0]).replace(/^\d+ /, '') : parts.join(', ')
  return { text: `${statuses.length} ${noun}: ${detail}`, hasFailed: failed > 0, running }
}

export const agentSpawned = (c: CleanChecklist, id: string): CleanChecklist =>
  c.agentIds?.includes(id) ? c : { ...c, agentIds: [...(c.agentIds ?? []), id] }

// Background agents reported back and Claude carries on with the same request
export const reopened = (c: CleanChecklist): CleanChecklist => {
  const { endedAt: _ended, outcome: _outcome, ...open } = c
  return open
}

export const card = (c: CleanChecklist, now: number, accent: string, agentStatuses: readonly string[] = []): Card => {
  const total = c.tasks.length
  const done = c.tasks.filter(t => t.status === 'completed').length
  const time = elapsed((c.endedAt ?? now) - c.startedAt)
  const counts = total ? `${done} of ${total} done · ` : ''
  const summary = agentsSummary(agentStatuses)

  if (c.endedAt !== undefined) {
    const still = summary?.running ? ` · ${summary.running} ${summary.running === 1 ? 'agent' : 'agents'} still running` : ''
    const footer = c.outcome === 'answer' ? `✓ ${counts || 'Done · '}${time}${still}` : `Stopped · ${counts}${time}${still}`
    return { title: c.title, filled: 0, rows: [], footer }
  }
  const agents = summary && { text: summary.text, hasFailed: summary.hasFailed }
  if (total === 0) return { title: c.title, filled: 0, rows: [], footer: `Working… ${time}`, ...(agents ? { agents } : {}) }

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
    ...(agents ? { agents: { ...agents, ...(working >= 0 ? { afterRow: working } : {}) } } : {}),
  }
}

// A block of a final answer, not only the whole: the terminal draws a reply in blocks and hides some parts
export const isFinalAnswer = (text: string, finals: readonly string[]) => {
  const block = text.trim()
  return block.length > 0 && finals.some(f => f.includes(block))
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

// A subagent's turn is not the person's request: it neither closes the card nor counts as a final answer
export const turnOutcome = (e: { reason: string; isAborted: boolean; agentId?: string }) =>
  e.agentId !== undefined ? undefined : e.reason === 'answer' && !e.isAborted ? 'answer' as const : 'stopped' as const

// After an error or refusal the person needs to see why Claude stopped; Esc is their own choice
export const revealsNotes = (e: { reason: string }) => e.reason === 'error' || e.reason === 'refusal'

// A continuation turn ("" text) belongs to the request already on the card
export const startsCard = (text: string) => text.trim().length > 0

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
