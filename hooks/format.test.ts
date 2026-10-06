import { describe, expect, test } from 'claude-code/testing'

import { barColor, defaultEffort, effortColor, effortFromCommand, family, mainEffort, modelColor, parseEffort, prettyModel, quotaColor, quotas, rows, sameModel, tokens } from './format'

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
    expect(plain(top)).toBe('[Opus 5.5] ⚙ 📁 main-2 | 🌿 main +1~2')
    expect(plain(bottom)).toBe('███░░░░░░░ 37% | ↑ 45.2k ↓ 1.2k | $1.23 | ⏱️ 2m 5s')
    expect(colorOf(top, 'Opus')).toBe('magenta')
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

  test('the model is colored by family; unknown ids stay cyan', async () => {
    expect(modelColor('claude-opus-5-5')).toBe('magenta')
    expect(modelColor('claude-opus-5-5[1m]')).toBe('magenta')
    expect(modelColor('claude-sonnet-5-5')).toBe('blue')
    expect(modelColor('claude-haiku-4-5-20251001')).toBe('green')
    expect(modelColor('claude-fable-5-1')).toBe('yellow')
    expect(modelColor('us.anthropic.claude-opus-5-5-v1')).toBe('magenta')
    expect(modelColor('some-gateway-model')).toBe('cyan')
  })

  test("a model's family is the alias /config's Model row takes", async () => {
    expect(family('claude-haiku-4-5-20251001')).toBe('haiku')
    expect(family('claude-sonnet-5-5')).toBe('sonnet')
    expect(family('claude-opus-5-5[1m]')).toBe('opus')
    expect(family('claude-fable-5-1')).toBe('fable')
    expect(family('some-gateway-model')).toBeUndefined()
  })

  test("a session starts at the model's saved effort, else the global one", async () => {
    const settings = { effortLevel: 'high', modelSettings: { 'claude-sonnet-5-5': { effortLevel: 'medium' } } }
    expect(defaultEffort(settings, 'claude-sonnet-5-5')).toBe('medium')
    expect(defaultEffort(settings, 'claude-opus-5-5')).toBe('high')
    expect(defaultEffort({}, 'claude-opus-5-5')).toBeUndefined()
    expect(defaultEffort({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'auto' } }, effortLevel: 'low' }, 'claude-opus-5-5')).toBe('low')
  })

  test('effort colors rise with cost', async () => {
    expect(effortColor('low')).toBe('subtle')
    expect(effortColor('medium')).toBe('cyan')
    expect(effortColor('high')).toBe('yellow')
    expect(effortColor('xhigh')).toBe('#ff8700')
    expect(effortColor('max')).toBe('red')
  })

  test('only the five effort levels are read, in any case', async () => {
    expect(parseEffort('high')).toBe('high')
    expect(parseEffort(' High ')).toBe('high')
    expect(parseEffort('XHIGH')).toBe('xhigh')
    expect(parseEffort('auto')).toBeUndefined()
    expect(parseEffort('')).toBeUndefined()
    expect(parseEffort(5)).toBeUndefined()
    expect(parseEffort(undefined)).toBeUndefined()
  })

  test('the picker marks a model current only for the same version', async () => {
    expect(sameModel('claude-opus-5-5', 'claude-opus-5-5[1m]')).toBe(true)
    expect(sameModel('claude-opus-5-5', 'claude-opus-4-1')).toBe(false)
    expect(sameModel('claude-haiku-4-5-20251001', 'claude-haiku-4-5')).toBe(true)
  })

  test("a subagent's requests do not change the session's effort", async () => {
    expect(mainEffort({ effort: 'xhigh' })).toBe('xhigh')
    expect(mainEffort({ effort: 'low', agentId: 'agent-1' })).toBeUndefined()
    expect(mainEffort({ effort: 4 })).toBeUndefined()
  })

  test('/effort is recorded only when Claude Code applied it', async () => {
    expect(effortFromCommand('medium', 'Set effort level to medium (this session only)')).toBe('medium')
    expect(effortFromCommand('max', 'Kept effort as high')).toBeUndefined()
    expect(effortFromCommand('max', 'Effort change cancelled')).toBeUndefined()
    expect(effortFromCommand('auto', 'Set effort level to auto')).toBeUndefined()
  })

  test('row 1 shows the effort in its color, then the picker button', async () => {
    const [top = []] = rows({ ...base, effort: 'high' })
    expect(plain(top)).toBe('[Opus 5.5] high ⚙ 📁 main-2 | 🌿 main +1~2')
    expect(colorOf(top, 'high')).toBe('yellow')
    expect(top.find(s => s.isPicker)?.text).toBe('⚙')

    const [unknown = []] = rows(base)
    expect(plain(unknown)).toBe('[Opus 5.5] ⚙ 📁 main-2 | 🌿 main +1~2')
    expect(plain(unknown)).not.toContain('undefined')
  })
})
