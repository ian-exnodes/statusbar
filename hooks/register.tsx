import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { parseEffort, quotas, rows } from './format'

const figures = atom({ plugin: 'statusbar', key: 'figures' } as const, null)
const tokensOut = atom({ plugin: 'statusbar', key: 'tokensOut' } as const, 0)
const lastTurnTokens = atom({ plugin: 'statusbar', key: 'lastTurnTokens' } as const, null)
const turnDelta = atom({ plugin: 'statusbar', key: 'turnDelta' } as const, null)
const effort = atom({ plugin: 'statusbar', key: 'effort' } as const, null)

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

// Live figures between events, like a statusLine command re-run by the CLI; git stays on events
async function tick($: EngineInterface) {
  const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
  await update($, figures, f => f && {
    ...f,
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

  // The level each request actually carries, after any downgrade for the model
  on('turn.step', async function* ($, e, next) {
    const level = parseEffort(e.effort)
    if (level) {
      await update($, effort, () => level)
      await update($, figures, f => f && { ...f, effort: level })
    }
    return yield* next(e)
  })

  // Typed or run from the picker: redraw right after, not at the next turn
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const level = parseEffort(e.args)
    if (level) await update($, effort, () => level)
    await refresh($)
    return r
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  // Below the prompt, where a statusLine command draws: our rows, then the engine's own hint line
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [f, hint] = await Promise.all([read($, figures), next(e)])
    if (f === null) return hint

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {rows(f).map((row, i) => (
          <Box key={`row${i}`}>
            {row.map(s => <Text color={s.color}>{s.text}</Text>)}
          </Box>
        ))}
        {hint}
      </Box>
    )
  })
}
