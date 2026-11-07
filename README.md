# Neural Core

A sci-fi holographic brain that lives beside your Claude Code chat and shows what Claude is doing, as it does it, plus the things worth keeping an eye on: how full its memory is, how much of your usage limit is left, and whether it's stuck in a loop.

## What it shows

- **A living amber brain.** A particle-and-wireframe hologram that never stops moving. Each kind of work has its own lobe, and a lobe burns white-hot and sends out a shockwave when Claude uses it:
  - **BUILD**: writing and editing files
  - **EXEC**: running commands
  - **SEE**: reading files and screenshots
  - **SEARCH**: searching code and the web
  - **SWARM**: helper agents, which also orbit the brain as satellites while they work
  - **LINK**: other tools
- **Vital-signs gauges.** Memory (context window) fill, your 5-hour limit with a reset countdown, your weekly limit and the session's cost. Each turns yellow at 70% and red at 90%.
- **Alerts.**
  - A toast and a ding when Claude is waiting for your OK on a permission prompt.
  - A chime when a long task finishes.
  - A warning when memory reaches 80%.
- **Loop detector.** If Claude repeats the same action without making changes, or fails three times in a row, the scene pulses red and tells you what's repeating.
- **Thought stream.**
  - Every step in plain English ("Edited register.tsx", "Ran npm test"), grouped by task.
  - Repeats folded together ("Read 5 files").
  - A filter dropdown, and rows you can click open for full detail.
  - A summary card at the end of each task.
- **History.** A 14-day chart plus today's, this week's and all-time totals, saved across sessions.
- **Interactive.**
  - A glow follows your mouse.
  - Hover over a lobe to see what it does.
  - Click a lobe to fire it.
  - A Calm button slows the motion, and a Sound button mutes the alerts.

It never calls the model, so it uses no extra tokens. Everything it reads stays on your machine.

## Install

At the prompt of a terminal session:

```
/plugin install neural-core --marketplace Ajebuta21/neural-core
```

Answer `y` to add the marketplace, then press Enter to install for your user.

From a shell:

```
claude plugin install neural-core --marketplace Ajebuta21/neural-core
```

In the Claude desktop app, click **+** next to the prompt box, then **Plugins**, then **Add marketplace** with `Ajebuta21/neural-core`, then **Add plugin**.

## Use

The panel opens when a session starts. Type `/brain` to reopen it.

The full holographic view draws in the Claude desktop app and the VS Code extension. A terminal session gets a text version with bar charts and the same thought stream.

Sounds play through `afplay` on macOS. Other systems skip them.

## License

MIT
