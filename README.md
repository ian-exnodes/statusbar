# statusbar

A Claude Code plugin (a "mod") that draws a colored, live status line under the prompt input:

```
[Opus 5.5] high ⚙ 📁 main-2 | 🌿 main +1~2
██░░░░░░░░ 21% | 5h ███████░░░ 76% | 7d █████████░ 92% | ↑ 208.1k ↓ 36.8k | $5.79 | ⏱️ 52m 47s | ▲ +21.4k last turn
```

It sits below the prompt, under Claude Code's own mode line (`▸▸ bypass permissions on …`).

## Requirements

- **Claude Code 2.1.290 or later** (check with `claude --version`). Older versions, such as 2.1.241, install the plugin and list it as enabled but show nothing, because they can't run plugin function hooks. Run `claude update`; if it stays on an older version, set the auto-update channel to **latest** in `/config` and update again.
- `git` on your `PATH` (for the branch and change counts)
- Tested on macOS only.

## Install

At the prompt of a Claude Code session:

```
/plugin install statusbar --marketplace ian-exnodes/statusbar
```

Answer `y` to add the marketplace, then pick the **user** scope so it runs in every session.

Or from a terminal:

```bash
claude plugin marketplace add ian-exnodes/statusbar
claude plugin install statusbar@ian-exnodes
```

A session that was already open picks it up after `/reload-plugins`, or start a new `claude`.

### Update

```bash
claude plugin marketplace update ian-exnodes
claude plugin update statusbar@ian-exnodes
```

What changed in each version: [CHANGELOG.md](CHANGELOG.md). To be notified of new versions, **Watch → Custom → Releases** on this repo.

### Uninstall

```bash
claude plugin uninstall statusbar
claude plugin marketplace remove ian-exnodes
```

## What each number means

### Row 1: where you are

| Shown | Meaning |
|---|---|
| `[Opus 5.5]` | The model this session runs on, colored by family: Opus magenta, Sonnet blue, Haiku green, Fable yellow. Other models are cyan. |
| `high` | The session's reasoning effort, colored by cost: low gray, medium cyan, high yellow, xhigh orange, max red. Hidden until known. |
| `⚙` | Opens the model and effort picker. |
| `📁 main-2` | The last folder of the session's working directory. |
| `🌿 main` | The current git branch. Hidden outside a git repo. |
| `+1` (green) | Files with **staged** changes (`git diff --cached`). |
| `~2` (yellow) | Files with **unstaged** changes to tracked files (`git diff`). Untracked files are not counted. |

### Row 2: what the session is using

| Shown | Meaning |
|---|---|
| `██░░░░░░░░ 21%` | **Context window fill.** Each block is 10%. It goes **up** as the conversation grows. Green below 70%, yellow from 70%, red from 90%. Near full, Claude Code compacts the conversation. |
| `5h ███████░░░ 76%` | **5-hour usage limit left.** It goes **down** as you work. Green above 30%, yellow at 30% or less, red at 10% or less (the opposite of the context bar). |
| `7d █████████░ 92%` | **Weekly (7-day) usage limit left.** Same bar and colors as the 5h one. |
| `↑ 208.1k` (cyan) | Input tokens the latest model response read: the whole conversation, system prompt and tools. This is what fills the context bar. |
| `↓ 36.8k` (yellow) | Output tokens the model has written, summed over every turn since the plugin loaded in this session. |
| `$5.79` (magenta) | Estimated cost of the session at API list prices. On a Claude subscription you are not billed this; it shows how much usage the session represents. |
| `⏱️ 52m 47s` | Time since the session started (a resumed session counts from its first launch). |
| `▲ +21.4k last turn` (gray) | How much the context grew during the last turn: context size now minus after the turn before. `▼ -N` means it shrank, for example after a compaction. The first turn of a new session counts from an empty context. |

The 5h and 7d bars appear only on a Claude subscription, once Claude Code has received its first limit reading. Other sessions (API key, gateways) show the line without them.

### Picker

Press `⚙` (or run `/statusbar`) to open a small box above the prompt:

    MODEL   Haiku 4.5  Sonnet 5.5  Opus 5.5  Fable 5.1   ✕
    EFFORT  Low  Medium  High  Xhigh  Max

The current model and effort are highlighted. A model is set through `/config`'s Model setting, which switches
at once and, like `/model`, also makes it your default for new sessions. When Claude Code needs to ask first (in a
long conversation, where the new model reads the whole conversation again, or Fable's one-time consent), the picker
runs `/model` instead and you answer its question; cancel and nothing changes. An effort runs `/effort`: it applies to
the session at once and also becomes that model's default effort for new sessions, as typing `/effort` does.
Claude Code prints nothing for it in the transcript; the status bar shows the new level.
The box closes on `✕` or when you send a message.

## When it updates

- Every second: context %, quotas, `↑`, `$`, and the timer.
- At session start and after each turn: model, folder, git branch and counts, `↓`, and `last turn`.
- Right after `/model` or `/effort`, typed or picked: model and effort.

## Your own status line

If you already have a `statusLine` command in `~/.claude/settings.json`, it keeps showing. The plugin can't turn it off. To keep only this one, remove `statusLine` from your settings, or make your script print nothing.

## What it runs

Read-only git commands in the session's folder (`git branch --show-current`, `git diff --numstat`, `git diff --cached --numstat`). It makes no network calls and writes no files. When you pick in the picker, it changes `/config`'s Model setting or runs `/model` or `/effort`, as you would.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`.claude-plugin/types/` is generated by Claude Code on each machine and is git-ignored.
