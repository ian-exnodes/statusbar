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

// The models every picker shows; pickerModels adds the ones the person has used (modelSettings)
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

export type EffortSettings = { effortLevel?: unknown; modelSettings?: Record<string, { effortLevel?: unknown } | undefined> }

// The level a session starts at: interactive /effort saves it per model (modelSettings), older settings keep one.
// After the start, the session's level carries across a model switch, so this is read only until one is known
export const defaultEffort = (settings: EffortSettings, model: string) =>
  parseEffort(settings.modelSettings?.[model]?.effortLevel) ?? parseEffort(settings.effortLevel)

export type PickerModel = { id: string; label: string }

// ponytail: 6 fit one picker row at 120 columns; a wider list would need a second row
const PICKER_MAX = 6

// 4-5 → 4.05, 4-1-20250805 → 4.01, 4-20250514 → 4: orders ids of a family newest first
const version = (id: string) => {
  const [, major = '0', minor = '0'] = /claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id) ?? []
  return Number(major) + Number(minor) / 100
}

// /effort saves a level per model id in modelSettings: any Claude id there is one the person has used.
// Aliases (opus), 'default' and other vendors' ids have no claude-<family>-<n> and are left out.
// Past the cap the newest stay, and the session's model always keeps a slot so the picker can highlight it
export const pickerModels = (settings: EffortSettings, current?: string): PickerModel[] => {
  const found: PickerModel[] = [...MODELS]
  const used = Object.keys(settings.modelSettings ?? {}).sort((a, b) => version(b) - version(a))
  for (const id of used) {
    if (family(id) && !found.some(m => sameModel(m.id, id))) found.push({ id, label: prettyModel(id) })
  }
  const shown = found.slice(0, PICKER_MAX)
  const own = current && found.find(m => sameModel(m.id, current))
  return own && !shown.includes(own) ? [...shown.slice(0, PICKER_MAX - 1), own] : shown
}

// turn.step fires for subagents too, and an agent may run at its own effort: only the main loop's counts
export const mainEffort = (step: { effort?: unknown; agentId?: string }) =>
  step.agentId === undefined ? parseEffort(step.effort) : undefined

// After /effort ran: a cancelled confirm reads "Kept …" (as /model's does) or "… cancelled" and changed nothing
export const effortFromCommand = (args: string, output: string) =>
  /^Kept\b|\bcancell?ed\b/i.test(output.trim()) ? undefined : parseEffort(args)

export const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

export const turnDelta = (n: number) =>
  `${n < 0 ? '▼ -' : '▲ +'}${tokens(Math.abs(n))} last turn`

export const barColor = (percent: number) =>
  percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : 'green'

// Mirror of barColor: a quota warns as what is left runs out
export const quotaColor = (remaining: number) =>
  remaining <= 10 ? 'red' : remaining <= 30 ? 'yellow' : 'green'

// 5 thin cells of 20%, ╸ for a half cell (10%), rounded down, so row 2 stays short; the % beside it is exact.
// Only the filled part takes the status color
export const meter = (percent: number, color: string): Segment[] => {
  const halves = Math.max(0, Math.min(10, Math.floor(percent / 10)))
  const filled = '━'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '╸' : '')
  const empty = '─'.repeat(5 - Math.ceil(halves / 2))
  return [...(filled ? [{ text: filled, color }] : []), ...(empty ? [{ text: empty, color: 'subtle' }] : [])]
}

const duration = (ms: number) => {
  const mins = Math.floor(ms / 60_000)
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export const quotas = (limits: readonly { kind: string; percentUsed: number }[]): StatusQuota[] =>
  limits.flatMap(l => {
    const label = LABELS[l.kind]
    return label ? [{ label, remaining: Math.max(0, Math.floor(100 - l.percentUsed)) }] : []
  })

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

export const rows = (f: StatusFigures): Segment[][] => {
  const git: Segment[] = f.branch === undefined ? [] : [
    { text: ` | 🌿 ${f.branch} ` },
    ...(f.staged ? [{ text: `+${f.staged}`, color: 'green' }] : []),
    ...(f.modified ? [{ text: `~${f.modified}`, color: 'yellow' }] : []),
    ...(f.untracked ? [{ text: `?${f.untracked}`, color: 'subtle' }] : []),
  ]

  return [
    [
      { text: `[${prettyModel(f.model)}]`, color: modelColor(f.model) },
      ...(f.effort ? [{ text: ` ${f.effort}`, color: effortColor(f.effort) }] : []),
      { text: ' ' },
      { text: '⚙ Command', isPicker: true },
      ...(f.isClean ? [{ text: ' ◐ Clean', color: 'green' }] : []),
      { text: ` | 📁 ${f.dir.split('/').pop()}` },
      ...git,
    ],
    [
      { text: 'Context ' },
      ...meter(f.percent, barColor(f.percent)),
      { text: ` ${f.percent}% | ` },
      ...f.quotas.flatMap(q => [
        { text: `Limit ${q.label} ` },
        ...meter(q.remaining, quotaColor(q.remaining)),
        { text: ` ${q.remaining}% | ` },
      ]),
      { text: `↑ ${tokens(f.tokensIn)}`, color: 'cyan' },
      { text: ' ' },
      { text: `↓ ${tokens(f.tokensOut)}`, color: 'yellow' },
      { text: ' | ' },
      { text: `$${f.usd.toFixed(2)}`, color: 'magenta' },
      { text: ` | ⏱️ ${duration(f.ms)}` },
      ...(f.turnDelta === undefined ? [] : [{ text: ' | ' }, { text: turnDelta(f.turnDelta), color: 'subtle' }]),
    ],
  ]
}

// What the person sees is all that counts: the timer shows minutes, so a second that changes nothing drawn is no change
export const sameRows = (a: StatusFigures, b: StatusFigures) => JSON.stringify(rows(a)) === JSON.stringify(rows(b))
