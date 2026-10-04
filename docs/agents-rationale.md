# Why some AGENTS.md rules exist

[AGENTS.md](../AGENTS.md) holds only the rules, because every agent loads it in
every session. The reasons behind some of them live here.

- **The user sets scope through milestones.** Placing an issue in a milestone is
  their judgement of what matters and when. Grouping a milestone's issues into
  phases follows the files each change touches, which an agent sees better, so
  the agent proposes it and the plan's approval covers it.
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
- **A pull request closing several issues says why it is one concern.** The
  merge tool checks only that a `One concern:` line is there; whether the
  reason holds is for review. What counts:
  - same cause: one fix closes both;
  - they can't be separated: either half alone leaves `main` broken or
    inconsistent;
  - same lines: separate pull requests would conflict;
  - one is a duplicate or subset of the other;
  - a plan grouping counts only when the line states one of these reasons.

  What doesn't count: both small, same area, already in the file, quicker.
  Pull request #201 closed two issues on the strength of a plan's phase
  grouping alone, with no reason written, and merged past a warning.
