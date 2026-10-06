import type { StatusFigures, StatusQuota } from '../types'

// Same colors as ~/.claude/statusline.sh
export type Segment = { text: string; color?: string }

// claude-opus-5-5 → Opus 5.5; anything else shown as is
export const prettyModel = (id: string) => {
  const [, name, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id) ?? []
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} ${major}.${minor}` : id
}

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
    [{ text: `[${prettyModel(f.model)}]`, color: 'cyan' }, { text: ` 📁 ${f.dir.split('/').pop()}` }, ...git],
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
