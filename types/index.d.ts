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
    }
  }
}
