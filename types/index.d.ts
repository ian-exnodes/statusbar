/** A usage-limit window and how much of it is left, 0 to 100. */
export type StatusQuota = { label: string; remaining: number }

/** A reasoning effort level, as /effort takes it. */
export type StatusEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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

export type StatusFigures = {
  model: string
  /** The session's effort; absent until settings, /effort or a turn names one. */
  effort?: StatusEffort
  /** Clean View is on: row 1 shows ◐ Clean. */
  isClean?: boolean
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
      cleanView: boolean
      checklist: CleanChecklist | null
      finals: string[]
      showNotes: boolean
    }
  }
}
