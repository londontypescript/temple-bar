# Delegation

How AGENTS.md's Delegation rules work in practice. Read it before
delegating. temple-bar's setup wrote this file.

- **Delegate to keep the reviewer's context clean,** not only to go faster.
  Justify parallel work, and never split it across overlapping files.
- **Don't edit a file you delegated** until its subagent reports back.
- **Shared files** (root `package.json`, the lockfile, tsconfig, lint
  config) are the orchestrator's. Subagents commit only; every merge and
  push is the orchestrator's.
- **A handoff report** has three parts: _resolved_, _deliberately
  deferred_, _needs a decision_. It gives break-it evidence for each new
  check, and says whether anything ran outside the sandbox.
- **The review bar:** the orchestrator reads every line of a subagent's
  change, lists what it must defend against, and checks each item.
  Rerunning the checks is not a review.
