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
