import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, RenderInput, ResolveInput } from 'claude-code'

import type { CardGroup, Trail } from './clean'

import {
  BAR_CELLS, addFinal, card, isFinalAnswer, startChecklist, taskCreated, taskUpdated, todosWritten, turnEnded,
  agentSpawned, finalsFromMessages, isRunning, activityOf, activitySet, fileChanged, trailFor, trailLine, reopened, revealsNotes, startsCard, toolChecklist, checklistReply, turnOutcome, withCleanViewNote,
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

// The tool Claude sends its plan to (CHECKLIST_TOOL); registered only while Clean View is on
const registerChecklist = ($: EngineInterface) => $.tool.register({
  name: 'checklist',
  description: "Shows the person your plan as a checklist while Clean View is on. Send the whole list each call.",
  // In the prompt's tool list, so Claude calls it without a ToolSearch first
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'A plain-language step, under 50 characters' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['subject', 'status'],
        },
      },
    },
    required: ['tasks'],
  },
})

// Kept across sessions in the plugin's store; loadCleanView reads it back at session start
const setCleanView = async ($: EngineInterface, isOn: boolean) => {
  await update($, cleanView, () => isOn)
  await $.store.set('cleanView', isOn)
  // ponytail: no API removes a tool, so one turned off mid-session stays listed until the next session
  // (its calls then answer "Not shown")
  if (isOn) await registerChecklist($)
}
const checklist = atom({ plugin: 'statusbar', key: 'checklist' } as const, null)
const finals = atom({ plugin: 'statusbar', key: 'finals' } as const, [])
// Set when a turn ends in an error or refusal: Claude's rows show until the next request, so the reason is visible
// Also the card's Details button: Claude's hidden rows show while it is set
const showNotes = atom({ plugin: 'statusbar', key: 'showNotes' } as const, false)
// The trail line drawn above each final answer of this session (last 50)
const trails = atom({ plugin: 'statusbar', key: 'trails' } as const, [])
// The person's prompt, from prompt.submit (which knows the origin) to the turn.start that follows it
const nextCard = atom({ plugin: 'statusbar', key: 'nextCard' } as const, null)
// The latest status of each helper agent on the card, read from $.agent.list() on the 1s tick
const agentStatus = atom({ plugin: 'statusbar', key: 'agentStatus' } as const, {})
// The card's animation frame: the working task's spinner and sliding bar
const frame = atom({ plugin: 'statusbar', key: 'frame' } as const, 0)
const FRAME_MS = 150

// A row drawn as nothing: a ui.render hook that returns null fails and the engine draws the row anyway
const empty = ($: EngineInterface, e: ResolveInput) => {
  const { Box } = $.ui.resolve(e)
  return <Box />
}

// Claude's work rows hide while Clean View is on, unless the card's Details shows them
const hidesRows = async ($: EngineInterface) => {
  const [isOn, isRevealed] = await Promise.all([read($, cleanView), read($, showNotes)])
  return isOn && !isRevealed
}

const loadCleanView = async ($: EngineInterface) => {
  const [stored, history] = await Promise.all([$.store.get('cleanView'), $.session.messages()])
  await update($, cleanView, () => stored === true)
  // A resumed session's earlier answers stay visible: they come back from the transcript, not this process's state
  await update($, finals, list => list.length ? list : finalsFromMessages(history))
}

const endCleanTurn = async (
  $: EngineInterface,
  e: { answer: string; reason: string; isAborted: boolean; agentId?: string },
) => {
  const outcome = turnOutcome(e)
  if (outcome === undefined) return
  await update($, finals, list => addFinal(list, e.answer))
  if (revealsNotes(e)) await update($, showNotes, () => true)
  if (!(await read($, cleanView))) return
  const now = await $.clock.now()
  await update($, checklist, c => c && c.endedAt === undefined ? turnEnded(c, now, outcome) : c)
  const c = await read($, checklist)
  if (c !== null && e.answer.trim()) {
    const trail: Trail = { answer: e.answer, line: trailLine(c.endedAt === undefined ? turnEnded(c, now, outcome) : c) }
    await update($, trails, list => [...list, trail].slice(-50))
  }
}

// The Clean View card for the band above the prompt, or null while there is none to show
const cleanCard = async ($: EngineInterface, e: RenderInput<'AbovePrompt'>) => {
  const [isOn, c, f, statusById, isRevealed] = await Promise.all([
    read($, cleanView), read($, checklist), read($, figures), read($, agentStatus), read($, showNotes),
  ])
  if (!isOn || c === null || e.props.hasSurvey) return null

  const { Box, Text, Button } = $.ui.resolve(e)
  const accent = modelColor(f?.model ?? '')
  const k = card(c, await $.clock.now(), accent, statusById, await read($, frame))

  // ▰ cells in the accent (red with a failed agent), ▱ cells dim; then an agent row each
  const groupRows = (g: CardGroup, key: string) => (
    <Box key={key} flexDirection="column" paddingLeft={2}>
      <Text>
        {g.cells.match(/▰+|▱+/g)?.map((run, i) => run[0] === '▰'
          ? <Text key={`run${i}`} color={g.color ?? accent}>{run}</Text> : <Text key={`run${i}`} dimColor>{run}</Text>)}
        {g.label && <Text color={g.color} dimColor={!g.color}> {g.label}</Text>}
      </Text>
      {g.agents.map((a, i) => (
        <Box key={`agent${i}`}>
          <Box flexGrow={1}><Text color={a.color}>{a.mark} {a.subject}</Text></Box>
          <Text color={a.color} dimColor={a.label === 'Done'}>  {a.label}</Text>
        </Box>
      ))}
      {g.more > 0 && <Text dimColor>+{g.more} more</Text>}
    </Box>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Box>
        <Box flexGrow={1}><Text bold><Text color={accent}>✧ </Text>{k.title}</Text></Box>
        <Box key="details">
          <Button key="details" plain label={isRevealed ? '[ Hide details ]' : '[ Details ]'} hover={{ inverse: true }}
            onPress={() => void update($, showNotes, shown => !shown)} />
        </Box>
      </Box>
      {k.step && (
        <Box>
          <Box width={14}><Text>{k.step}</Text></Box>
          <Text color={accent}>{'▓'.repeat(k.filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_CELLS - k.filled)}</Text>
        </Box>
      )}
      {k.group && groupRows(k.group, 'loose')}
      {k.rows.map((row, i) => (
        <Box key={`task${i}`} flexDirection="column">
          <Box>
            <Box flexGrow={1}>
              <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>{row.mark} {row.subject}</Text>
            </Box>
            <Text color={row.color} bold={row.isBold} dimColor={row.isDim}>  {row.label}</Text>
          </Box>
          {row.group && groupRows(row.group, `group${i}`)}
        </Box>
      ))}
      {k.footer && <Text color={k.footer.startsWith('✓') ? 'green' : undefined} dimColor={!k.footer.startsWith('✓')}>{k.footer}</Text>}
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
// ponytail: updates every second on purpose: the Clean View card's seconds timer redraws with it while nothing animates
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
  const [isOn, c] = await Promise.all([read($, cleanView), read($, checklist)])
  if (isOn && c?.agents?.length) {
    const agents = await $.agent.list()
    await update($, agentStatus, () => Object.fromEntries(agents.map(a => [a.id, a.status])))
  }
}

// Moves the card's frame on only while something on it moves, so an idle session does not redraw
async function animate($: EngineInterface) {
  const [isOn, c, statusById] = await Promise.all([read($, cleanView), read($, checklist), read($, agentStatus)])
  const hasRunning = !!c?.agents?.some(a => isRunning(statusById[a.id]))
  const isMoving = c !== null && (hasRunning || (c.endedAt === undefined && c.tasks.some(t => t.status === 'in_progress')))
  if (isOn && isMoving) await update($, frame, n => n + 1)
}

export const register: Register = on => {
  let ticker: { cancel: () => void } | undefined
  let animator: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'statusbar', description: 'Open or close the model and effort picker' })
    await loadCleanView($)
    if (await read($, cleanView)) await registerChecklist($)
    await seedTurn($)
    await refresh($)
    ticker?.cancel()
    ticker = $.clock.every(1000, () => tick($))
    animator?.cancel()
    animator = $.clock.every(FRAME_MS, () => animate($))
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
            {row.map((s, j) => s.isPicker
              ? <Button key="picker" label={s.text} onPress={() => void togglePicker($)} />
              : <Text key={`seg${j}`} color={s.color}>{s.text}</Text>)}
          </Box>
        ))}
        {hint}
      </Box>
    )
  })

  // The person sending a message closes it; another plugin's prompt does not
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin') return next(e)
    await closePicker($)
    if (startsCard(e)) await update($, nextCard, () => e.text)
    // Clean View's planning note rides with the person's prompt as context they never see:
    // cc-plugin-sec-default keeps user-tier plugins out of prompt.compose (the system prompt)
    return (await read($, cleanView)) ? next({ ...e, context: withCleanViewNote(e.context) }) : next(e)
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
    const request = await read($, nextCard)
    if (request !== null) {
      await update($, nextCard, () => null)
      await update($, showNotes, () => false)
      if (await read($, cleanView)) {
        const now = await $.clock.now()
        await update($, checklist, () => startChecklist(request, now))
      }
    } else {
      // A continuation (agents reported back or sent a message): the same request goes on, so the card re-opens
      await update($, checklist, c => c && c.endedAt !== undefined ? reopened(c) : c)
    }
    return next(e)
  })

  // Helper agents the main conversation starts join the card; agents started by agents are their parent's business
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = r.agentId
    if (r.deny === undefined && id !== undefined && e.parentAgentId === undefined && (await read($, cleanView))) {
      await update($, checklist, c => c && agentSpawned(c, id, e.description))
    }
    return r
  })

  // Claude's task calls build the card; a subagent's own tasks are not the person's request
  // The plugin's own checklist tool (CHECKLIST_TOOL): answered here, nothing beneath runs. The generated types list
  // only the tools present at the last load, and the validator reads the name only as a literal, hence the cast
  on('tool.call', { tool: 'mcp__statusbar__checklist' as never }, async ($, e: { agentId?: string }) => {
    const isShown = e.agentId === undefined && (await read($, cleanView)) && (await read($, checklist)) !== null
    if (isShown) await update($, checklist, c => c && toolChecklist(c, e))
    const text = checklistReply(isShown)
    return { result: text, text }
  })

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

  // Every tool call: the card's activity line (main loop) and the files changed (helper agents' edits count too)
  on('tool.call', async ($, e, next) => {
    const isOn = await read($, cleanView)
    if (isOn && e.agentId === undefined) await update($, checklist, c => c && activitySet(c, activityOf(e.tool, e)))
    const r = await next(e)
    if (!isOn) return r
    const path = (e as { file_path?: unknown }).file_path
    if (r.deny === undefined && !r.isError && ['Edit', 'Write', 'NotebookEdit'].includes(e.tool) && typeof path === 'string') {
      await update($, checklist, c => c && fileChanged(c, path))
    }
    return r
  })

  // Drawing only: the stored transcript is untouched, so switching Clean View off shows every row again
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (await hidesRows($)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => (await hidesRows($)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => (await hidesRows($)) ? empty($, e) : next(e))
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (await hidesRows($)) ? empty($, e) : next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const [isOn, list, isRevealed, trailList] = await Promise.all([read($, cleanView), read($, finals), read($, showNotes), read($, trails)])
    if (!isOn) return next(e)
    if (!isRevealed && !isFinalAnswer(e.props.text, list)) return empty($, e)
    // The request's trail line sits above its final answer
    const line = trailFor(e.props.text, trailList)
    if (line === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>{line}</Text>
        {await next(e)}
      </Box>
    )
  })
}
