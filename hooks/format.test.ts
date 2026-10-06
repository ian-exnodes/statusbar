import { describe, expect, test } from 'claude-code/testing'

import { barColor, prettyModel, quotaColor, quotas, rows, tokens } from './format'

const base = { model: 'claude-opus-5-5', dir: '/x/main-2', branch: 'main', staged: 1, modified: 2,
  percent: 37, tokensIn: 45_230, tokensOut: 1_200, usd: 1.234, ms: 125_000, quotas: [] }
const plain = (r: { text: string }[]) => r.map(s => s.text).join('')
const colorOf = (r: { text: string; color?: string }[], text: string) => r.find(s => s.text.includes(text))?.color

describe('statusbar rows', () => {
  test('model ids read the way the old statusline.sh showed them', async () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('some-gateway-model')).toBe('some-gateway-model')
  })

  test('token counts shorten to k and M', async () => {
    expect(tokens(999)).toBe('999')
    expect(tokens(45_230)).toBe('45.2k')
    expect(tokens(1_250_000)).toBe('1.3M')
  })

  test('the bar warns as the context window fills', async () => {
    expect(barColor(69)).toBe('green')
    expect(barColor(70)).toBe('yellow')
    expect(barColor(90)).toBe('red')
  })

  test('two rows with the statusline.sh text and colors', async () => {
    const [top = [], bottom = []] = rows(base)
    expect(plain(top)).toBe('[Opus 5.5] 📁 main-2 | 🌿 main +1~2')
    expect(plain(bottom)).toBe('███░░░░░░░ 37% | ↑ 45.2k ↓ 1.2k | $1.23 | ⏱️ 2m 5s')
    expect(colorOf(top, 'Opus')).toBe('cyan')
    expect(colorOf(top, '+1')).toBe('green')
    expect(colorOf(top, '~2')).toBe('yellow')
    expect(colorOf(bottom, '↑')).toBe('cyan')
    expect(colorOf(bottom, '↓')).toBe('yellow')
    expect(colorOf(bottom, '$')).toBe('magenta')
  })

  test('last turn shows context growth, and shrinkage after a compaction', async () => {
    const [, bottom = []] = rows({ ...base, turnDelta: 98_300 })
    expect(plain(bottom)).toContain(' | ▲ +98.3k last turn')
    const [, shrunk = []] = rows({ ...base, turnDelta: -120_000 })
    expect(plain(shrunk)).toContain('▼ -120.0k last turn')
    const [, first = []] = rows(base)
    expect(plain(first)).not.toContain('last turn')
  })

  test('quota bars show what is left, warning as it runs out (opposite of the context bar)', async () => {
    expect(quotaColor(31)).toBe('green')
    expect(quotaColor(30)).toBe('yellow')
    expect(quotaColor(10)).toBe('red')
    expect(quotas([
      { kind: 'five_hour', percentUsed: 23.5 },
      { kind: 'seven_day', percentUsed: 8 },
      { kind: 'spend_limit', percentUsed: 50 },
    ])).toEqual([{ label: '5h', remaining: 76 }, { label: '7d', remaining: 92 }])
    expect(quotas([{ kind: 'five_hour', percentUsed: 104 }])).toEqual([{ label: '5h', remaining: 0 }])

    const [, bottom = []] = rows({ ...base, quotas: [{ label: '5h', remaining: 76 }, { label: '7d', remaining: 8 }] })
    expect(plain(bottom)).toBe('███░░░░░░░ 37% | 5h ███████░░░ 76% | 7d ░░░░░░░░░░ 8% | ↑ 45.2k ↓ 1.2k | $1.23 | ⏱️ 2m 5s')
    expect(colorOf(bottom, '███████░░░')).toBe('green')
    expect(colorOf(bottom, '░░░░░░░░░░')).toBe('red')
  })

  test('no git segment outside a repo', async () => {
    const [top = []] = rows({ ...base, branch: undefined })
    expect(plain(top)).not.toContain('🌿')
  })
})
