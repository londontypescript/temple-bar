# Why the AGENTS.md rules exist

[AGENTS.md](../AGENTS.md) holds only the rules, because every agent loads it
in every session. The reasons behind them live here. temple-bar's setup
wrote this file; add your own project's reasons as you add rules.

- **AGENTS.md stays within 200 lines and 32 KiB.** Every agent loads all of
  it in every session. Agent guidance is under 200 lines, and some agents
  stop reading past 32 KiB by default.
- **Rules live in the block, one or two lines each.** Reasons, examples
  and procedure live in the companion docs the block links to, each linked
  with when to read it. A link is read only when an agent thinks it worth
  reading, so a rule itself never moves out of the block (decision 56,
  [ADR 0009](adr/0009-readme-and-agents-md.md)).
- **Ask what we're building first.** An agent that starts coding from a
  vague request builds its own guess, and the rework costs more than the
  question.
- **The user sets scope through milestones.** Placing an issue in a
  milestone is their judgement of what matters and when. Grouping a
  milestone's issues into phases follows the files each change touches,
  which an agent sees better, so the agent proposes it and the plan's
  approval covers it.
- **Every issue's premise is checked.** An issue records what someone
  believed when they wrote it. Checked against the ADRs and git
  history, a stale premise is caught before work starts on it, not after.
- **Open questions are settled early.** Asked weeks after an issue was
  filed, a question reaches a user who no longer has its context and must
  remember what it was and why. Some questions only appear in research or
  code, so filing, the decide-first pass and the build each catch their
  own.
- **The tracker moves at every subtask.** A tracker that only moves at phase
  end tells the user nothing about where to spend the rest of a usage
  window.
- **One GitHub reference per line.** GitHub expands each issue or pull
  request reference into its full title, so several in one sentence become
  one long run-on line. Nested under a change bullet, a closing reference
  stays out of the squash message, since merge keeps only top-level
  bullets, and GitHub still honours it.
- **The update before work stops has fixed fields, and the user sees it
  first.** The next session often runs in a different tool, whose memory is
  separate; the issue is the one record every tool and person can read.
  Without the base commit, the exact command and what has been ruled out, a
  resumed session repeats dead ends. It is the update carrying the most
  state, so the user reads it before it is posted.
- **Sessions are named after the project and the work,** for example
  `<project>: setup and design`. Sessions titled from their first prompt
  all look alike, and one that has moved on is hard to find again.
- **Commit often inside a branch.** Commits are local and squashed at merge,
  so they cost nothing in history or CI. Work lost to a usage limit or a
  crashed session comes down to the uncommitted change.
- **The harness makes every worktree.** An agent that runs
  `git worktree add` itself also picks where it goes, and folders beside
  the project pile up where the user doesn't want them. The harness knows
  where its worktrees belong and cleans up its own; preparing a branch
  before handing it over (dependencies, a base commit) happens in the
  worktree the harness made. The user's answer when the harness can't help
  covers the rest of the session, so a known limit isn't raised for every
  branch.
- **Push once.** Every push to a pull request runs the full CI. Pushing
  while a change is still being discussed burns runs and buries the one
  that matters.
- **A pull request the judge refuses carries its own squash body.** The
  user merges it as admin on GitHub, which can fill in the description as
  the commit body, so a note to the user or a "Generated with" line there
  lands in the history. The checklist sits in a comment so it never does,
  and it covers what merge would have checked, because an admin merge
  skips merge's own enforcement.
- **The gate's scripts are never no-ops.** The gate trusts `typecheck`,
  `lint`, `format:check` and `test` to run real checks; a script that only
  exits 0 makes a green gate mean nothing.
- **Two strikes, then stop.** A third attempt in the same session usually
  repeats the same wrong assumption, in a context now crowded with failed
  attempts. The cause is often upstream (a known bug, a changed default),
  which only a search of upstream issues and changelogs finds. Going back
  to the last clean commit keeps the failed attempts out of the fix, and a
  fresh subagent, which you may suggest, starts without them.
- **A pull request closing several issues says why it is one concern.** The
  merge tool checks only that a `One concern:` line is there; whether the
  reason holds is for review. What counts:
  - same cause: one fix closes both;
  - they can't be separated: either half alone leaves the default branch
    broken or inconsistent;
  - same lines: separate pull requests would conflict;
  - one is a duplicate or subset of the other;
  - a plan grouping counts only when the line states one of these reasons.

  What doesn't count: both small, same area, already in the file, quicker.
  Pull request #201 closed two issues on the strength of a plan's phase
  grouping alone, with no reason written, and merged past a warning.

- **A pull request over the size limits says why it is one concern.**
  Merge checks only that a `One concern:` line is there. What counts: a
  mechanical change across many files (a rename, a codemod, a dependency
  move); a refactor that can't land half-done, because either half alone
  leaves the default branch broken or inconsistent. What doesn't: it's all
  one feature, it's all small, the plan grouped it. Test lines count
  against their own, higher limit, so tests push a change over less often,
  but past either limit, or the file limit, the line is still needed.
- **Wide changes are checked for duplication.** A decision that was right
  at prototype scale can quietly expire; editing four copies hides that it
  has.
- **Incidents are built in two halves.** Agents see what went wrong in the
  moment; the user sees which of those matter across projects. Neither has
  all of it.
- **Search before proposing an incident.** Proposing an incident for a gap
  that is already tracked costs the user a decision each time, and agents
  kept doing it. The `incident` label alone misses incidents filed by
  people who can't set labels, so titles are searched too.
- **The test runner starts one shell on Windows.** Git for Windows' shells
  share one `/tmp` mapping, set from the `TEMP` of the first one to start and
  kept while any of them is alive. The suite gives each test file its own
  temp folder and deletes it when the file ends, so without a long-lived
  shell of Git's own install holding `/tmp` on a folder that outlives the
  run, a shell started later can find `/tmp` gone and warn. Only an MSYS
  process of that install can hold it, so this one command can't be Node.
