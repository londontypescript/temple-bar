# Why some AGENTS.md rules exist

[AGENTS.md](../AGENTS.md) holds only the rules, because every agent loads it in
every session. The reasons behind some of them live here.

- **The user writes the intake.** Its grouping carries their judgement of what
  matters, so an agent reordering it replaces that judgement with its own.
- **The tracker moves at every subtask.** A tracker that only moves at phase end
  tells the user nothing about where to spend the rest of a usage window.
- **Incidents are built in two halves.** Agents see what went wrong in the
  moment; the user sees which of those matter across projects. Neither has all
  of it.
- **Wide changes are checked for duplication.** A decision that was right at
  prototype scale can quietly expire; editing four copies hides that it has.
- **AGENTS.md stays within 200 lines and 32 KiB.** Every agent loads all of it
  in every session. Anthropic's guidance is under 200 lines, and Codex stops
  reading past 32 KiB by default.
