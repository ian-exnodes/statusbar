import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EFFORTS, MODELS, effortColor, effortFromCommand, family, mainEffort, modelColor, parseEffort, quotas, rows, sameModel } from './format'

const figures = atom({ plugin: 'statusbar', key: 'figures' } as const, null)
const tokensOut = atom({ plugin: 'statusbar', key: 'tokensOut' } as const, 0)
const lastTurnTokens = atom({ plugin: 'statusbar', key: 'lastTurnTokens' } as const, null)
const turnDelta = atom({ plugin: 'statusbar', key: 'turnDelta' } as const, null)
const effort = atom({ plugin: 'statusbar', key: 'effort' } as const, null)
const isPickerOpen = atom({ plugin: 'statusbar', key: 'isPickerOpen' } as const, false)

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
    // The last level /effort or a turn named, else the settings' default
    effort: picked ?? parseEffort((settings as { effortLevel?: unknown }).effortLevel),
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

  // Typed or run from the picker: redraw right after, not at the next turn
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
              ? <Button key="picker" plain label={s.text} onPress={() => void update($, isPickerOpen, open => !open)} />
              : <Text color={s.color}>{s.text}</Text>)}
          </Box>
        ))}
        {hint}
      </Box>
    )
  })

  // The person sending a message closes it; the picker's own /model and /effort runs do not
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') await update($, isPickerOpen, () => false)
    return next(e)
  })

  // A second way in, in case a click on ⚙ under the prompt does not reach the plugin
  on('command.run', { command: 'statusbar' }, async $ => {
    await update($, isPickerOpen, open => !open)
    return { text: '' }
  })

  // The picker: a band above the prompt, so it stays a few rows tall in every layout (a pane docks full height)
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [isOpen, f] = await Promise.all([read($, isPickerOpen), read($, figures)])
    if (!isOpen || f === null || e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    // Same as typing it, so Claude Code's own checks (the model-switch confirm) still apply
    const run = (command: 'model' | 'effort', args: string) =>
      void $.command.run({ command, args }).catch(err => $.ui.toast(`statusbar: /${command} ${args} failed: ${String(err)}`))
    // /config's Model row switches in milliseconds; /model takes a second or two behind its own screen.
    // The row refuses what only a dialog may decide (the long-conversation confirm, Fable's consent): then /model asks
    const pickModel = async (id: string) => {
      const alias = family(id)
      const set = alias ? await $.config.set({ key: 'model', value: alias }).catch(() => undefined) : undefined
      if (set?.deny !== undefined || set === undefined) return run('model', id)
      const model = await $.session.model()
      await update($, figures, now => now && { ...now, model })
    }
    const option = (key: string, label: string, fill: string | undefined, onPress: () => void) => (
      <Box key={key} backgroundColor={fill} paddingX={1}>
        <Button key={key} plain label={label} hover={{ inverse: true }} onPress={onPress} />
      </Box>
    )

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={modelColor(f.model)} paddingX={1}>
        <Box>
          <Box width={8}><Text dimColor>MODEL</Text></Box>
          {MODELS.map(m => option(`model-${m.id}`, m.label,
            sameModel(m.id, f.model) ? modelColor(m.id) : undefined, () => void pickModel(m.id)))}
          <Box flexGrow={1} />
          <Button key="close" plain label="✕" onPress={() => void update($, isPickerOpen, () => false)} />
        </Box>
        <Box>
          <Box width={8}><Text dimColor>EFFORT</Text></Box>
          {EFFORTS.map(level => option(`effort-${level}`, level.charAt(0).toUpperCase() + level.slice(1),
            level === f.effort ? effortColor(level) : undefined, () => run('effort', level)))}
        </Box>
      </Box>
    )
  })
}
