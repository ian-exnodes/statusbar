import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CLEAN_VIEW_NOTE } from './clean'

type World = {
  isClean?: boolean
  /** More of what the plugin's store holds at the start. */
  store?: Record<string, unknown>
  /** The environment variables the plugin reads. */
  env?: Record<string, string>
  /** What `git status` prints; 'timeout' makes the call reject, 'not-a-repo' exits 128. */
  git?: string
  messages?: { role: 'user' | 'assistant'; text: string }[]
  modelSettings?: Record<string, { effortLevel?: string }>
  /** usage.startedAt; the mock clock starts at 0. */
  startedAt?: number
  gitRuns: string[][]
  commands: string[]
  toasts: string[]
  /** How many times the plugin wrote its `figures` atom. */
  figureWrites: number
}

const fresh = (over: Partial<World> = {}): World =>
  ({ git: '# branch.oid abc1234def\n# branch.head main\n', gitRuns: [], commands: [], toasts: [], figureWrites: 0, ...over })

const ok = (stdout: string, exitCode = 0) =>
  ({ value: { exitCode, stdout, stderr: exitCode ? 'fatal' : '', isStdoutTruncated: false, isStderrTruncated: false } })

/** Stands in for the engine and git beneath the plugin. */
function world(on: On, w: World): MockClock {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, { ...(w.isClean ? { cleanView: true } : {}), ...w.store })
  on('env.get', (_$, e) => ({ value: w.env?.[e.name] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/x/statusbar' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: w.startedAt ?? 0, context: { percent: 10, tokens: 20_000, window: 200_000 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: (w.messages ?? []).map(m => ({ ...m, toolUses: [] })) }))
  on('settings.read', () => ({ value: { modelSettings: w.modelSettings ?? {} } as never }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // Without this, Clean View's checklist tool fails to register, the plugin toasts, and Clean View stays off
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__statusbar__${e.name}` } }))
  on('command.run', (_$, e) => { w.commands.push(`${e.command} ${e.args}`.trim()); return { text: '' } })
  on('config.set', (_$, e) => { w.commands.push(`config ${e.key}=${String(e.value)}`); return { value: e.value } })
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.toast', (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  // The engine's own drawing beneath the plugin: an answer's text, nothing for the rest
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => { const { Text } = $.ui.resolve(e); return <Text>{e.props.text}</Text> })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('state.set', (_$, e, next) => { if (e.key === 'figures') w.figureWrites++; return next(e) })
  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'git') return ok('')
    w.gitRuns.push([...e.argv])
    if (w.git === 'timeout') return { deny: 'timed out' }
    if (w.git === 'not-a-repo') return ok('', 128)
    return ok(w.git ?? '')
  })
  return clock
}

const start = async ($: Engine) => { await $.session.start({ cwd: '/x/statusbar', surface: 'terminal', isInteractive: true }) }

const HINT = { plugin: 'statusbar', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const
const BAND = {
  plugin: 'statusbar', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 40, bodyColumns: 120, scroll: { offset: 0, bodyRows: 39 }, view: {} },
} as const
const COMPOSER = { kind: 'composer' } as const
const PLUGIN = { kind: 'plugin', name: 'other' } as const
const STATUSBAR = { command: 'statusbar', args: '', origin: COMPOSER, presentation: { isFullscreen: false, columns: 120 } } as const

describe('register hooks', () => {
  test('Clean View adds its planning note once per prompt, and never to a plugin prompt', async ($, on) => {
    const w = fresh({ isClean: true })
    world(on, w)
    await start($)
    expect(w.toasts).toEqual([])
    const once = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: COMPOSER })
    expect(once.context?.filter(c => c === CLEAN_VIEW_NOTE)).toHaveLength(1)
    const again = await $.prompt.submit({ text: 'and this', wait: false, origin: COMPOSER, context: [CLEAN_VIEW_NOTE] } as never)
    expect(again.context?.filter(c => c === CLEAN_VIEW_NOTE)).toHaveLength(1)
    const other = await $.prompt.submit({ text: 'from a plugin', wait: false, origin: PLUGIN })
    expect(other.context ?? []).not.toContain(CLEAN_VIEW_NOTE)
  })

  test('the picker closes on a prompt the person sends, not on a plugin one', async ($, on) => {
    world(on, fresh())
    await start($)
    await $.command.run(STATUSBAR)
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeDefined()
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: PLUGIN })
    await ui.redraw(BAND.props)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeDefined()
    await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
    await ui.redraw(BAND.props)
    expect(await ui.find({ type: 'Text', text: 'MODEL' })).toBeUndefined()
    await ui.unmount()
  })

  test('a resumed session shows its earlier final answers through Clean View, not the notes between', async ($, on) => {
    world(on, fresh({
      isClean: true,
      messages: [
        { role: 'user', text: 'first request' },
        { role: 'assistant', text: 'Let me look.' },
        { role: 'assistant', text: 'Done: the bug was in auth.' },
        { role: 'user', text: 'second request' },
      ],
    }))
    await start($)
    const answer = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Done: the bug was in auth.', isFirstOfReply: true } })
    expect(await answer.find({ text: 'Done: the bug was in auth.' })).toBeDefined()
    await answer.unmount()
    const note = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', component: 'AssistantMessage', props: { text: 'Let me look.', isFirstOfReply: true } })
    expect(await note.find({ text: 'Let me look.' })).toBeUndefined()
    await note.unmount()
  })
})

describe('the picker button', () => {
  const VIEW = { columns: 120, rows: 40 }

  test('on the main screen clicks cannot reach it, so the row shows /statusbar to type', async ($, on) => {
    world(on, fresh())
    await start($)
    const ui = await $.ui.mount({ ...HINT, viewport: { ...VIEW, isFullscreen: false } })
    expect(await ui.find({ type: 'Text', text: '⚙ /statusbar' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '⚙ Command' })).toBeUndefined()
    await ui.unmount()
  })

  test('on the desktop it stays a button, fullscreen or not', async ($, on) => {
    world(on, fresh())
    await start($)
    const ui = await $.ui.mount({ ...HINT, surface: 'desktop', viewport: { ...VIEW, isFullscreen: false } })
    expect(await ui.find({ type: 'Button', text: '⚙ Command' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⚙ /statusbar' })).toBeUndefined()
    await ui.unmount()
  })

  test('in fullscreen it is a button, and pressing it opens the picker', async ($, on) => {
    world(on, fresh())
    await start($)
    const ui = await $.ui.mount({ ...HINT, viewport: { ...VIEW, isFullscreen: true } })
    expect(await ui.find({ type: 'Text', text: '⚙ /statusbar' })).toBeUndefined()
    await ui.press({ key: 'picker' })
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: 'MODEL' })).toBeDefined()
    await band.unmount()
    await ui.unmount()
  })
})

describe('icons on Windows', () => {
  const VIEW = { columns: 120, rows: 40 }
  const MAIN = { ...HINT, viewport: { ...VIEW, isFullscreen: false } }
  const text = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>, t: string) => (await ui.find({ type: 'Text', text: t })) !== undefined

  test('auto is plain where OS is Windows_NT, with /statusbar to type', async ($, on) => {
    world(on, fresh({ env: { OS: 'Windows_NT' } }))
    await start($)
    const ui = await $.ui.mount(MAIN)
    expect(await text(ui, '/statusbar')).toBe(true)
    expect(await text(ui, '⚙ /statusbar')).toBe(false)
    expect(await text(ui, '🌿')).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^statusbar$/ })).toBeDefined()
    expect(await text(ui, '📁')).toBe(false)
    await ui.unmount()
  })

  test('auto is emoji without it, and emoji or plain win over the system', async ($, on) => {
    world(on, fresh())
    await start($)
    const ui = await $.ui.mount(MAIN)
    expect(await text(ui, '⚙ /statusbar')).toBe(true)
    await ui.unmount()
  })

  test('emoji keeps the icons on Windows', { options: { glyphs: 'emoji' } }, async ($, on) => {
    world(on, fresh({ env: { OS: 'Windows_NT' } }))
    await start($)
    const ui = await $.ui.mount(MAIN)
    expect(await text(ui, '⚙ /statusbar')).toBe(true)
    await ui.unmount()
  })

  test('plain drops the icons off Windows', { options: { glyphs: 'plain' } }, async ($, on) => {
    const w = fresh()
    world(on, w)
    await start($)
    const ui = await $.ui.mount({ ...HINT, viewport: { ...VIEW, isFullscreen: true } })
    expect(await ui.find({ type: 'Button', text: 'Command' })).toBeDefined()
    await ui.unmount()
    expect(w.toasts).toEqual([])
  })

  test('the font and click hint shows once per install', async ($, on) => {
    const w = fresh({ env: { OS: 'Windows_NT' } })
    world(on, w)
    await start($)
    expect(w.toasts.filter(t => t.includes('plain text on Windows'))).toHaveLength(1)
    await start($)
    const ui = await $.ui.mount(MAIN)
    await ui.unmount()
    expect(w.toasts.filter(t => t.includes('plain text on Windows'))).toHaveLength(1)
  })

  test('no hint for someone who chose emoji, even on the main screen', { options: { glyphs: 'emoji' } }, async ($, on) => {
    const w = fresh({ env: { OS: 'Windows_NT' } })
    world(on, w)
    await start($)
    const ui = await $.ui.mount(MAIN)
    await ui.unmount()
    expect(w.toasts).toEqual([])
  })

  test('under auto the start and the main-screen renders raise exactly one toast between them', async ($, on) => {
    const w = fresh({ env: { OS: 'Windows_NT' } })
    world(on, w)
    await start($)
    const a = await $.ui.mount(MAIN)
    const b = await $.ui.mount(MAIN)
    await a.unmount()
    await b.unmount()
    expect(w.toasts.filter(t => t.includes('plain text on Windows'))).toHaveLength(1)
  })

  test('a stored flag keeps the hint away', async ($, on) => {
    const w = fresh({ store: { windowsHint: true }, env: { OS: 'Windows_NT' } })
    world(on, w)
    await start($)
    expect(w.toasts).toEqual([])
  })
})

describe('git on the status bar', () => {
  const v2 = '# branch.oid 1234567890abcdef\n# branch.head main\n1 M. N... 1 1 1 a b x.ts\n1 .M N... 1 1 1 a b y.ts\n? z.md\n'

  test('one git process per refresh, counting untracked files', async ($, on) => {
    const w = fresh({ git: v2 })
    world(on, w)
    await start($)
    expect(w.gitRuns).toEqual([['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch']])
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '?1' })).toBeDefined()
    await ui.unmount()
  })

  test('a detached HEAD shows its short commit, not an empty branch', async ($, on) => {
    world(on, fresh({ git: '# branch.oid 1234567890abcdef\n# branch.head (detached)\n' }))
    await start($)
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 (1234567)' })).toBeDefined()
    await ui.unmount()
  })

  test('outside a repo there is no branch segment', async ($, on) => {
    world(on, fresh({ git: 'not-a-repo' }))
    await start($)
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿' })).toBeUndefined()
    await ui.unmount()
  })

  test('a timed-out git call keeps the last branch and counts', async ($, on) => {
    const w = fresh({ git: v2 })
    world(on, w)
    await start($)
    w.git = 'timeout'
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: [] })
    const ui = await $.ui.mount(HINT)
    expect(await ui.find({ type: 'Text', text: '🌿 main' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '?1' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the 1s tick', () => {
  test('an idle second writes nothing; the minute it shows changing writes once', async ($, on) => {
    const w = fresh({ startedAt: 0 })
    const clock = world(on, w)
    await start($)
    await clock.advance(1_000)
    const after = w.figureWrites
    await clock.advance(5_000)
    expect(w.figureWrites).toBe(after)
    await clock.advance(60_000 - clock.now())
    expect(w.figureWrites).toBe(after + 1)
  })

  test('a working card still gets a write every second, for its seconds timer', async ($, on) => {
    const w = fresh({ isClean: true })
    const clock = world(on, w)
    await start($)
    await $.prompt.submit({ text: 'fix the bug', wait: false, origin: COMPOSER })
    await $.turn.start({ text: 'fix the bug', turnId: 't1' })
    const before = w.figureWrites
    await clock.advance(3_000)
    expect(w.figureWrites).toBe(before + 3)
  })
})

describe('the model picker', () => {
  test('lists a model from modelSettings and switches to that exact id with /model', async ($, on) => {
    const w = fresh({ modelSettings: { 'claude-opus-4-1': { effortLevel: 'high' } } })
    world(on, w)
    await start($)
    await $.command.run(STATUSBAR)
    const ui = await $.ui.mount(BAND)
    expect(await ui.find({ type: 'Button', text: 'Opus 4.1' })).toBeDefined()
    await ui.press({ key: 'model-claude-opus-4-1' })
    expect(w.commands).toContain('model claude-opus-4-1')
    await ui.unmount()
  })
})

describe('fullscreen offer on Windows', () => {
  const VIEW = { columns: 120, rows: 40 }
  const MAIN_BAND = { ...BAND, viewport: { ...VIEW, isFullscreen: false } }
  const FULL_BAND = { ...BAND, viewport: { ...VIEW, isFullscreen: true } }
  const WIN = { OS: 'Windows_NT' }
  const offer = async (ui: Awaited<ReturnType<Engine['ui']['mount']>>) => ui.find({ type: 'Button', key: 'fullscreen-yes' })

  test('the main screen on Windows offers fullscreen; 1 runs /tui fullscreen and it is not asked again', async ($, on) => {
    const w = fresh({ env: WIN })
    world(on, w)
    await start($)
    const ui = await $.ui.mount(MAIN_BAND)
    expect(await offer(ui)).toBeDefined()
    await ui.press({ key: 'fullscreen-yes' })
    expect(w.commands).toContain('tui fullscreen')
    await ui.redraw(MAIN_BAND.props)
    expect(await offer(ui)).toBeUndefined()
    await ui.unmount()
    await start($)
    const again = await $.ui.mount(MAIN_BAND)
    expect(await offer(again)).toBeUndefined()
    await again.unmount()
  })

  test('2 declines: nothing runs and it is not asked again', async ($, on) => {
    const w = fresh({ env: WIN })
    world(on, w)
    await start($)
    const ui = await $.ui.mount(MAIN_BAND)
    await ui.press({ key: 'fullscreen-no' })
    expect(w.commands).not.toContain('tui fullscreen')
    await ui.redraw(MAIN_BAND.props)
    expect(await offer(ui)).toBeUndefined()
    await ui.unmount()
  })

  const typed = (said: string, isYes: boolean) =>
    test(`sending "${said}" answers it ${isYes ? 'yes' : 'no'}, and it never reaches Claude`, async ($, on) => {
      const w = fresh({ env: WIN })
      world(on, w)
      await start($)
      const ui = await $.ui.mount(MAIN_BAND)
      const r = await $.prompt.submit({ text: said, wait: false, origin: COMPOSER })
      expect(r.drop).toBeDefined()
      await ui.redraw(MAIN_BAND.props)
      expect(w.commands.includes('tui fullscreen')).toBe(isYes)
      expect(await offer(ui)).toBeUndefined()
      await ui.unmount()
    })
  typed('1', true)
  typed(' Yes ', true)
  typed('no', false)

  test('with no offer showing, 1 is an ordinary prompt', async ($, on) => {
    const w = fresh({ env: WIN, store: { fullscreenAsked: true } })
    world(on, w)
    await start($)
    const ui = await $.ui.mount(MAIN_BAND)
    const r = await $.prompt.submit({ text: '1', wait: false, origin: COMPOSER })
    expect(r.drop).toBeUndefined()
    expect(w.commands).not.toContain('tui fullscreen')
    await ui.unmount()
  })

  test('while Claude works the question is hidden, so 1 goes to Claude', async ($, on) => {
    const w = fresh({ env: WIN })
    world(on, w)
    await start($)
    const ui = await $.ui.mount({ ...MAIN_BAND, props: { ...MAIN_BAND.props, isWorking: true } })
    const r = await $.prompt.submit({ text: '1', wait: false, origin: COMPOSER })
    expect(r.drop).toBeUndefined()
    await ui.unmount()
  })

  const none = (name: string, over: Partial<World>, mount: typeof MAIN_BAND) =>
    test(`no offer ${name}`, async ($, on) => {
      world(on, fresh(over))
      await start($)
      const ui = await $.ui.mount(mount)
      expect(await offer(ui)).toBeUndefined()
      await ui.unmount()
    })
  none('over SSH', { env: { ...WIN, SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' } }, MAIN_BAND)
  none('in fullscreen', { env: WIN }, FULL_BAND)
  none('off Windows', {}, MAIN_BAND)
  none('once answered', { env: WIN, store: { fullscreenAsked: true } }, MAIN_BAND)
  none('while Claude works', { env: WIN }, { ...MAIN_BAND, props: { ...MAIN_BAND.props, isWorking: true } })
  none('while a survey holds the band', { env: WIN }, { ...MAIN_BAND, props: { ...MAIN_BAND.props, hasSurvey: true } })
})
