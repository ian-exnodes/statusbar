# Picker models follow Claude Code's own list

## Why

The picker's MODEL row is a fixed list in `hooks/format.ts` (`MODELS`): Haiku 4.5, Sonnet 5.5, Opus 5.5, Fable 5.1.
When Anthropic ships a model (Fable 5.2), the row is out of date until someone edits the code. The family buttons
already switch to the newest model, because they set the `/config` Model row to an alias (`fable`); only the labels
and the highlight are stale: the button reads "Fable 5.1", it is not highlighted while on 5.2, and an extra
"Fable 5.2" slot appears at the end.

## Goals

- A new model family that Claude Code offers shows up in the picker with no code change.
- A button never shows a version number that is known to be wrong: it names the version only once it is known.
- No API calls, no credentials, no network.

Non-goals: listing every version Anthropic offers; a picker that knows a new version before the person has used it.

## Approaches

1. **Families from `$.config.list()`, versions remembered (picked).** The `/config` Model row is a `choice` row whose
   `options` come from the running Claude Code (2.1.326 gives `default, sonnet, opus, haiku, fable, best, sonnet[1m],
   opus[1m], fable[1m], opusplan`). Families come from there; each family's version comes from ids the session has
   seen. Free, follows Claude Code updates.
2. **Anthropic's Models API (`GET /v1/models`).** Gives exact ids, but needs an API key; a plugin cannot read the
   session's credentials, and subscription users have none. Ruled out.
3. **Keep the fixed list, edit it per release.** What exists now; it is the problem.

Label choice (picked by the person): **(a)** a family button shows `Family x.y` when its version is known, else just
`Family`.

    MODEL   Haiku 4.5  Sonnet 5.5  Opus  [Fable 5.2]   ✕

## Design

- **Families.** Read `$.config.list()`, take the row with key `model`, keep its options that are a bare word
  (`/^[a-z]+$/`), minus the ones that are not a family: `default`, `best`, and words ending in `plan` (`opusplan`).
  Order: haiku, sonnet, opus, fable as today, then any new family in the order Claude Code lists it. If the read fails,
  the row is missing, or it has no options, fall back to the four families of today's `MODELS`.
- **Versions.** The newest id seen per family, from two sources: Claude ids in `settings.modelSettings` (as
  `pickerModels` reads them today) and `$.session.model()` on every refresh. The ids seen in sessions are kept in
  `$.store` (`latestModels`: family → id) so they survive restarts. Only a newer version replaces a stored one, so
  switching to Opus 4.1 by id does not relabel the Opus button.
- **Labels.** `prettyModel(id)` when the family has an id, else the family name capitalized (`Opus`).
- **Older versions.** Ids in `modelSettings` that are older than their family's newest keep their own slots after
  the family buttons, as today (newest first, `PICKER_MAX` 6, the current model always keeps a slot).
- **Picking.** A family button sets the alias through `$.config.set({ key: 'model', value: family })`, falling back to
  `/model <family>` when the row refuses, as today. An older-version slot runs `/model <id>`, as today.
- **Highlight.** The family button lights when the session's model is that family's newest known id; an older version
  lights its own slot.
- `MODELS` stays only as the fallback family list; its version numbers go.

Known gap: when a newer version ships, the label shows the last version used until the person first lands on the
new one (picking the family button does that, and the label updates at once). The button still switches to the newest.

## Left to the builder

- When to read `$.config.list()`: at session start and when the picker opens is enough; it is not needed on the 1s tick.
- Colors for a family with no entry in `FAMILY_COLORS`: cyan, as `modelColor` already does.
- Tests in `hooks/format.test.ts` for the family filter, ordering, labels with and without a version, the
  never-downgrade rule and the fallback; update the `pickerModels` expectations.
- README Picker section, CHANGELOG, plugin version 0.9.14; mark the "list is fixed in code" note in
  `docs/superpowers/specs/2026-10-06-model-effort-picker-design.md` as superseded.
