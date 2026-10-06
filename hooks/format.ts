import type { StatusEffort, StatusFigures, StatusQuota } from '../types'

// Same colors as ~/.claude/statusline.sh
// isPicker: drawn as the button that opens the model and effort picker
export type Segment = { text: string; color?: string; isPicker?: true }

// claude-opus-5-5 → Opus 5.5; anything else shown as is
export const prettyModel = (id: string) => {
  const [, name, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id) ?? []
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} ${major}.${minor}` : id
}

export const EFFORTS: readonly StatusEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// ponytail: no API lists the models a session may use; add a new model here when it ships
export const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
] as const

const FAMILY_COLORS: Record<string, string> = { opus: 'magenta', sonnet: 'blue', haiku: 'green', fable: 'yellow' }

// opus, sonnet…: also the alias /config's Model row takes. Not anchored, so a Bedrock or Vertex id
// (us.anthropic.claude-opus-…) still finds its family
export const family = (id: string) => /claude-([a-z]+)-\d/.exec(id)?.[1]

export const modelColor = (id: string) => FAMILY_COLORS[family(id) ?? ''] ?? 'cyan'

const EFFORT_COLORS: Record<StatusEffort, string> = {
  low: 'subtle', medium: 'cyan', high: 'yellow', xhigh: '#ff8700', max: 'red',
}

export const effortColor = (level: StatusEffort) => EFFORT_COLORS[level]

// From settings, /effort's argument or turn.step: 'auto', '' or a number is not a level to show
export const parseEffort = (value: unknown): StatusEffort | undefined => {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return EFFORTS.find(e => e === level)
}

export const sameModel = (a: string, b: string) => prettyModel(a) === prettyModel(b)

type EffortSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }

// The level a session starts at: interactive /effort saves it per model (modelSettings), older settings keep one.
// After the start, the session's level carries across a model switch, so this is read only until one is known
export const defaultEffort = (settings: EffortSettings, model: string) =>
  parseEffort(settings.modelSettings?.[model]?.effortLevel) ?? parseEffort(settings.effortLevel)

// turn.step fires for subagents too, and an agent may run at its own effort: only the main loop's counts
export const mainEffort = (step: { effort?: unknown; agentId?: string }) =>
  step.agentId === undefined ? parseEffort(step.effort) : undefined

// After /effort ran: a cancelled confirm reads "Kept …" (as /model's does) and changed nothing
export const effortFromCommand = (args: string, output: string) =>
  /^Kept\b|cancel/i.test(output.trim()) ? undefined : parseEffort(args)

export const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

export const turnDelta = (n: number) =>
  `${n < 0 ? '▼ -' : '▲ +'}${tokens(Math.abs(n))} last turn`

export const barColor = (percent: number) =>
  percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'

// Mirror of barColor: a quota warns as what is left runs out
export const quotaColor = (remaining: number) =>
  remaining <= 10 ? 'red' : remaining <= 30 ? 'yellow' : 'green'

const bar = (percent: number) => {
  const filled = Math.max(0, Math.min(10, Math.floor(percent / 10)))
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const quotas = (limits: readonly { kind: string; percentUsed: number }[]): StatusQuota[] =>
  limits.flatMap(l => {
    const label = LABELS[l.kind]
    return label ? [{ label, remaining: Math.max(0, Math.floor(100 - l.percentUsed)) }] : []
  })

export const rows = (f: StatusFigures): Segment[][] => {
  const secs = Math.floor(f.ms / 1000)
  const git: Segment[] = f.branch === undefined ? [] : [
    { text: ` | 🌿 ${f.branch} ` },
    ...(f.staged ? [{ text: `+${f.staged}`, color: 'green' }] : []),
    ...(f.modified ? [{ text: `~${f.modified}`, color: 'yellow' }] : []),
  ]

  return [
    [
      { text: `[${prettyModel(f.model)}]`, color: modelColor(f.model) },
      ...(f.effort ? [{ text: ` ${f.effort}`, color: effortColor(f.effort) }] : []),
      { text: ' ' },
      { text: '⚙ Command', isPicker: true },
      { text: ` | 📁 ${f.dir.split('/').pop()}` },
      ...git,
    ],
    [
      { text: bar(f.percent), color: barColor(f.percent) },
      { text: ` ${f.percent}% | ` },
      ...f.quotas.flatMap(q => [
        { text: `${q.label} ` },
        { text: bar(q.remaining), color: quotaColor(q.remaining) },
        { text: ` ${q.remaining}% | ` },
      ]),
      { text: `↑ ${tokens(f.tokensIn)}`, color: 'cyan' },
      { text: ' ' },
      { text: `↓ ${tokens(f.tokensOut)}`, color: 'yellow' },
      { text: ' | ' },
      { text: `$${f.usd.toFixed(2)}`, color: 'magenta' },
      { text: ` | ⏱️ ${Math.floor(secs / 60)}m ${secs % 60}s` },
      ...(f.turnDelta === undefined ? [] : [{ text: ' | ' }, { text: turnDelta(f.turnDelta), color: 'subtle' }]),
    ],
  ]
}
