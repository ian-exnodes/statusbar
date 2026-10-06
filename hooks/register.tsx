import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EFFORTS, MODELS, defaultEffort, effortColor, effortFromCommand, family, mainEffort, modelColor, quotas, rows, sameModel } from './format'

const figures = atom({ plugin: 'statusbar', key: 'figures' } as const, null)
const tokensOut = atom({ plugin: 'statusbar', key: 'tokensOut' } as const, 0)
const lastTurnTokens = atom({ plugin: 'statusbar', key: 'lastTurnTokens' } as const, null)
const turnDelta = atom({ plugin: 'statusbar', key: 'turnDelta' } as const, null)
const effort = atom({ plugin: 'statusbar', key: 'effort' } as const, null)
const PICKER = 'statusbar-picker'

// A pane, so Esc closes it (closeOnEscape); a band cannot hear Esc. In the fullscreen layout a pane docks beside the transcript
async function togglePicker($: EngineInterface) {
  const isOpen = (await $.ui.panes()).some(p => p.id === PICKER)
  if (isOpen) return $.ui.close({ id: PICKER })
  await $.ui.open({ id: PICKER, title: 'Model & effort', focus: true, closeOnEscape: true, rows: 3 })
}

const closePicker = ($: EngineInterface) => $.ui.close({ id: PICKER }).catch(() => undefined)

const lines = (s: string) => s.split('\n').filter(Boolean).length

async function refresh($: EngineInterface) {
  const [model, dir, usage, now, out, delta, picked, settings] = await Promise.all([
    $.session.model(), $.session.cwd(), $.session.usage(), $.clock.now(), read($, tokensOut), read($, turnDelta),
    read($, effort), $.settings.read(),
  ])
  const [branch, staged, modified] = await Promise.all([
    $.process.run(['git', 'branch', '--show-current']).catch(() => undefined),
    $.process.run(['git', 'diff', '--cached', '--numstat']).catch(() => undefined),
    $.process.run(['git', 'diff', '--numstat']).catch(() => undefined),
  ])
  const isRepo = branch?.exitCode === 0

  await update($, figures, () => ({
    model,
    // The last level /effort, the picker or a turn named, else the level the session started at
    effort: picked ?? defaultEffort(settings as Parameters<typeof defaultEffort>[0], model),
    dir,
    branch: isRepo ? branch.stdout.trim() : undefined,
    staged: isRepo ? lines(staged?.stdout ?? '') : 0,
    modified: isRepo ? lines(modified?.stdout ?? '') : 0,
    percent: usage.context.percent ?? 0,
    tokensIn: usage.context.tokens ?? 0,
    tokensOut: out,
    usd: usage.cost?.usd ?? 0,
    ms: now - usage.startedAt,
    turnDelta: delta ?? undefined,
    quotas: quotas(usage.rateLimits),
  }))
}

// Context growth over the turn, as ak-cockpit shows it: tokens now minus tokens after the turn before
async function recordTurn($: EngineInterface) {
  const [{ context }, before] = await Promise.all([$.session.usage(), read($, lastTurnTokens)])
  if (context.tokens === undefined) return

  // A fresh session (or one just cleared) starts from an empty window
  const now = context.tokens
  await update($, turnDelta, () => now - (before ?? 0))
  await update($, lastTurnTokens, () => now)
}

// So the first turn after install or reload already has a 'last turn' to show
async function seedTurn($: EngineInterface) {
  const [{ context }, before] = await Promise.all([$.session.usage(), read($, lastTurnTokens)])
  if (before === null && context.tokens !== undefined) {
    await update($, lastTurnTokens, () => context.tokens ?? null)
  }
}

// Live figures between events, like a statusLine command re-run by the CLI; git stays on events.
// The model is read here too: no event reaches a user plugin when it changes (an interactive /model raises
// no command.run, and cc-plugin-sec-default keeps classic.PostModelSwitch from user-tier plugins)
async function tick($: EngineInterface) {
  const [usage, now, model] = await Promise.all([$.session.usage(), $.clock.now(), $.session.model()])
  await update($, figures, f => f && {
    ...f,
    model,
    percent: usage.context.percent ?? 0,
    tokensIn: usage.context.tokens ?? 0,
    usd: usage.cost?.usd ?? 0,
    ms: now - usage.startedAt,
    quotas: quotas(usage.rateLimits),
  })
}

export const register: Register = on => {
  let ticker: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'statusbar', description: 'Open or close the model and effort picker' })
    await seedTurn($)
    await refresh($)
    ticker?.cancel()
    ticker = $.clock.every(1000, () => tick($))
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    // ponytail: counts from install; the engine exposes no session-wide output total
    await update($, tokensOut, n => n + (e.usage?.output_tokens ?? 0))
    const r = await next(e)
    await recordTurn($)
    await refresh($)
    return r
  })

  // The level each main-loop request actually carries, after any downgrade for the model
  on('turn.step', async function* ($, e, next) {
    const level = mainEffort(e)
    if (level) {
      await update($, effort, () => level)
      await update($, figures, f => f && { ...f, effort: level })
    }
    return yield* next(e)
  })

  // Typed /effort. The picker's own runs never reach this plugin's hooks (re-entry), so the picker records its pick itself
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const level = effortFromCommand(e.args, r.text ?? '')
    if (level) await update($, effort, () => level)
    await refresh($)
    return r
  })


  // Below the prompt, where a statusLine command draws: our rows, then the engine's own hint line
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [f, hint] = await Promise.all([read($, figures), next(e)])
    if (f === null) return hint

    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows(f).map((row, i) => (
          <Box key={`row${i}`}>
            {row.map(s => s.isPicker
              ? <Button key="picker" plain label={s.text} onPress={() => void togglePicker($)} />
              : <Text color={s.color}>{s.text}</Text>)}
          </Box>
        ))}
        {hint}
      </Box>
    )
  })

  // The person sending a message closes it; another plugin's prompt does not
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') await closePicker($)
    return next(e)
  })

  // A second way in, in case a click on ⚙ under the prompt does not reach the plugin
  on('command.run', { command: 'statusbar' }, async $ => {
    await togglePicker($)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const f = await read($, figures)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (f === null) return <Text dimColor>Reading the session…</Text>

    // Same as typing it, so Claude Code's own checks (the model-switch confirm) still apply
    const run = (command: 'model' | 'effort', args: string) =>
      $.command.run({ command, args }).catch(err => void $.ui.toast(`statusbar: /${command} ${args} failed: ${String(err)}`))
    // Claude Code prints nothing for a plugin's /effort and this plugin's /effort hook is skipped, so record it here
    const pickEffort = async (level: string) => {
      const r = await run('effort', level)
      const applied = r && effortFromCommand(level, r.text ?? '')
      if (!applied) return
      await update($, effort, () => applied)
      await update($, figures, now => now && { ...now, effort: applied })
    }
    // /config's Model row switches in milliseconds; /model takes a second or two behind its own screen.
    // The row refuses what only a dialog may decide (the long-conversation confirm, Fable's consent): then /model asks
    const pickModel = async (id: string) => {
      const alias = family(id)
      const set = alias ? await $.config.set({ key: 'model', value: alias }).catch(() => undefined) : undefined
      if (set?.deny !== undefined || set === undefined) return void run('model', id)
      const model = await $.session.model()
      await update($, figures, now => now && { ...now, model })
    }
    const option = (key: string, label: string, fill: string | undefined, onPress: () => void) => (
      <Box key={key} backgroundColor={fill} paddingX={1}>
        <Button key={key} plain label={label} hover={{ inverse: true }} onPress={onPress} />
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Box width={8}><Text dimColor>MODEL</Text></Box>
          {MODELS.map(m => option(`model-${m.id}`, m.label,
            sameModel(m.id, f.model) ? modelColor(m.id) : undefined, () => void pickModel(m.id)))}
          <Box flexGrow={1} />
          <Button key="close" plain label="✕" onPress={() => void closePicker($)} />
        </Box>
        <Box>
          <Box width={8}><Text dimColor>EFFORT</Text></Box>
          {EFFORTS.map(level => option(`effort-${level}`, level.charAt(0).toUpperCase() + level.slice(1),
            level === f.effort ? effortColor(level) : undefined, () => void pickEffort(level)))}
        </Box>
      </Box>
    )
  })
}
