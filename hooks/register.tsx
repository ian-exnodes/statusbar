import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, RenderInput, ResolveInput } from 'claude-code'

import {
  BAR_CELLS, addFinal, card, isFinalAnswer, startChecklist, taskCreated, taskUpdated, todosWritten, turnEnded,
} from './clean'
import { EFFORTS, MODELS, defaultEffort, effortColor, effortFromCommand, family, mainEffort, modelColor, quotas, rows, sameModel } from './format'

const figures = atom({ plugin: 'statusbar', key: 'figures' } as const, null)
const tokensOut = atom({ plugin: 'statusbar', key: 'tokensOut' } as const, 0)
const lastTurnTokens = atom({ plugin: 'statusbar', key: 'lastTurnTokens' } as const, null)
const turnDelta = atom({ plugin: 'statusbar', key: 'turnDelta' } as const, null)
const effort = atom({ plugin: 'statusbar', key: 'effort' } as const, null)
// The picker is a band above the prompt: a few rows in every layout. A pane would close on Esc (a band never
// hears Esc) but docks full height beside the transcript in the fullscreen layout; the small box won
const isPickerOpen = atom({ plugin: 'statusbar', key: 'isPickerOpen' } as const, false)

const togglePicker = ($: EngineInterface) => update($, isPickerOpen, open => !open)
const closePicker = ($: EngineInterface) => update($, isPickerOpen, () => false)

// Clean View: hides Claude's work rows and shows a checklist card (pure logic in clean.ts)
const cleanView = atom({ plugin: 'statusbar', key: 'cleanView' } as const, false)

// Kept across sessions in the plugin's store; loadCleanView reads it back at session start
const setCleanView = async ($: EngineInterface, isOn: boolean) => {
  await update($, cleanView, () => isOn)
  await $.store.set('cleanView', isOn)
}
const checklist = atom({ plugin: 'statusbar', key: 'checklist' } as const, null)
const finals = atom({ plugin: 'statusbar', key: 'finals' } as const, [])

// A row drawn as nothing: a ui.render hook that returns null fails and the engine draws the row anyway
const empty = ($: EngineInterface, e: ResolveInput) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

const CLEAN_VIEW_SECTION = 'The person is using Clean View: they see a checklist of your tasks, not your tool calls. '
  + 'Before working on a request, break it into a few short tasks with TaskCreate (subject: a plain-language step, '
  + 'under 50 characters). Mark each task in_progress when you start it and completed when it is done. '
  + 'For a quick question, one task is enough.'

const loadCleanView = async ($: EngineInterface) => {
  const stored = await $.store.get('cleanView')
  await update($, cleanView, () => stored === true)
}

const endCleanTurn = async ($: EngineInterface, e: { answer: string; reason: string; isAborted: boolean }) => {
  await update($, finals, list => addFinal(list, e.answer))
  if (!(await read($, cleanView))) return
  const now = await $.clock.now()
  const outcome = e.reason === 'answer' && !e.isAborted ? 'answer' : 'stopped'
  await update($, checklist, c => c && c.endedAt === undefined ? turnEnded(c, now, outcome) : c)
}

// The Clean View card for the band above the prompt, or null while there is none to show
const cleanCard = async ($: EngineInterface, e: RenderInput<'AbovePrompt'>) => {
  const [isOn, c, f] = await Promise.all([read($, cleanView), read($, checklist), read($, figures)])
  if (!isOn || c === null || e.props.hasSurvey) return null

  const { Box, Text } = $.ui.resolve(e)
  const accent = modelColor(f?.model ?? '')
  const k = card(c, await $.clock.now(), accent)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Text bold><Text color={accent}>✧ </Text>{k.title}</Text>
      {k.step && (
        <Box>
          <Box width={14}><Text>{k.step}</Text></Box>
          <Text color={accent}>{'▓'.repeat(k.filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_CELLS - k.filled)}</Text>
        </Box>
      )}
      {k.rows.map((row, i) => (
        <Box key={`task${i}`}>
          <Box flexGrow={1}>
            <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>{row.mark} {row.subject}</Text>
          </Box>
          <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>  {row.label}</Text>
        </Box>
      ))}
      {k.footer && <Text color={c.outcome === 'answer' ? 'green' : undefined} dimColor={c.outcome !== 'answer'}>{k.footer}</Text>}
    </Box>
  )
}

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
    await loadCleanView($)
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
    await endCleanTurn($, e)
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
    const [f, hint, isClean] = await Promise.all([read($, figures), next(e), read($, cleanView)])
    if (f === null) return hint

    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows({ ...f, isClean }).map((row, i) => (
          <Box key={`row${i}`}>
            {row.map(s => s.isPicker
              ? <Button key="picker" label={s.text} onPress={() => void togglePicker($)} />
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [isOpen, f, below, card, isClean] = await Promise.all([
      read($, isPickerOpen), read($, figures), next(e), cleanCard($, e), read($, cleanView),
    ])
    const { Box, Text, Button } = $.ui.resolve(e)
    // The Clean View card sits above whatever else the band holds
    const rest = card ? <Box flexDirection="column">{card}{below}</Box> : below
    if (!isOpen || f === null || e.props.hasSurvey) return rest

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

    // The picker draws above the rest of the band (the Clean View card)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={modelColor(f.model)} paddingX={1}>
          <Box>
            <Box width={12}><Text dimColor>MODEL</Text></Box>
            {MODELS.map(m => option(`model-${m.id}`, m.label,
              sameModel(m.id, f.model) ? modelColor(m.id) : undefined, () => void pickModel(m.id)))}
            <Box flexGrow={1} />
            <Button key="close" plain label="✕" onPress={() => void closePicker($)} />
          </Box>
          <Box>
            <Box width={12}><Text dimColor>EFFORT</Text></Box>
            {EFFORTS.map(level => option(`effort-${level}`, level.charAt(0).toUpperCase() + level.slice(1),
              level === f.effort ? effortColor(level) : undefined, () => void pickEffort(level)))}
          </Box>
          <Box>
            <Box width={12}><Text dimColor>CLEAN VIEW</Text></Box>
            {option('clean-off', 'Off', isClean ? undefined : 'subtle', () => void setCleanView($, false))}
            {option('clean-on', 'On', isClean ? 'green' : undefined, () => void setCleanView($, true))}
          </Box>
        </Box>
        {rest}
      </Box>
    )
  })

  // Clean View

  on('turn.start', async ($, e, next) => {
    if (await read($, cleanView)) {
      const now = await $.clock.now()
      await update($, checklist, () => startChecklist(e.text, now))
    }
    return next(e)
  })

  // Claude's task calls build the card; a subagent's own tasks are not the person's request
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      // next(e) is typed for any tool; this hook only ever sees TaskCreate
      const { id, subject } = (r.result as BuiltinToolResults['TaskCreate']).task
      await update($, checklist, c => c && taskCreated(c, id, subject))
    }
    return r
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      await update($, checklist, c => c && taskUpdated(c, { taskId: e.taskId, subject: e.subject, status: e.status }))
    }
    return r
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.agentId === undefined && (await read($, cleanView))) {
      await update($, checklist, c => c && todosWritten(c, e.todos))
    }
    return r
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, cleanView))) return r
    return { ...r, sections: [...r.sections, { id: 'statusbar.clean-view', text: CLEAN_VIEW_SECTION, scope: 'session' as const }] }
  })

  // Drawing only: the stored transcript is untouched, so switching Clean View off shows every row again
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (await read($, cleanView)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => (await read($, cleanView)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => (await read($, cleanView)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (await read($, cleanView)) ? empty($, e) : next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const [isOn, list] = await Promise.all([read($, cleanView), read($, finals)])
    if (!isOn || isFinalAnswer(e.props.text, list)) return next(e)
    return empty($, e)
  })
}
