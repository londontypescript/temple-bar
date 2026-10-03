# Agent directives

Binds every agent working here (Claude Code, Codex, Antigravity or any other)
and humans. This is the only copy of these rules. Harness config may duplicate
one to fail faster, never to replace it.

The plan is `docs/plans/temple-bar.md`. Its §1 is the approved decisions list:
check every brief and change against it. Work is tracked in GitHub issues.

## 0. This repo

- This repo is gated by the last published temple-bar. Its own source never
  runs as its tooling, and no feature exists to make it do so.
- The pinned temple-bar's hooks refuse commits to local `main` and any move of
  `main` that doesn't come from `origin/main`. Every change goes through a pull
  request.
- Bumping the pinned temple-bar version is a deliberate change in its own pull
  request, never a side effect of other work.
- The repo is public. Nothing committed or filed here (code, plans, issues,
  commit messages) carries project-private details: credentials, customer data,
  internal hostnames, or anything from another project beyond its name and a
  one-line incident summary.
- Write "TypeScript" with a capital S. Never use the TypeScript logo.

## 1. Before code

Non-trivial work starts with a written plan the user has approved. Break it into
verifiable phases, say which can run in parallel, and rate each one **routine**,
**involved** or **delicate** so the user can choose models. Never pick or switch
models yourself. A struggling subagent is stopped and reported, not moved to
another model. Ask clarifying questions before the work, not during it.

Decisions agreed in discussion go into the plan's decisions list, which the user
approves. Summaries and briefs are checked against that list, not memory.

The user writes the intake themselves: the grouped list of fixes and features.
Do not reorder it by your own priorities, and do not offer to generate it.

GitHub issues are the live tracker: update the issue you work on **at every
subtask**, not at phase end. Drafts go in `.temple-bar/`, this checkout's
gitignored working folder; there is no handoff file. Git holds the record:
decisions, phase definitions, and each phase's status when it starts and ends.

## 2. Branching

`main` changes only through merged pull requests, and every merge is a squash.

- **One branch, one pull request, one commit on `main`.** A multi-phase plan
  gets one pull request per phase, merged in order; a release is a milestone
  and a tag, never one big pull request.
- **Squash merges only.** The `main` ruleset refuses any other merge and
  requires linear history and signed commits (GitHub signs each squash).
- **Never commit to `main`**, locally or on GitHub. A one-line fix gets a branch
  too. Local `main` only ever moves by fast-forwarding to `origin/main`.
- **Every branch gets its own worktree,** with dependencies installed before
  its first commit. The primary checkout stays on `main`, so parallel work
  never collides. Where the worktree goes is the harness's choice.

The orchestrator merges a pull request once CI and CodeQL are green, except
one that changes AGENTS.md, bumps the pinned temple-bar, tags or publishes:
those need the user's yes. Agents push branches and open pull requests, never
`main`.

**Push once, when finished.** Every push to a pull request runs the full CI.
Draft locally, and push only when the work is final: agreed with the user
for anything that needs their yes (AGENTS.md, plan decisions, a README
rewrite), finished by the agent otherwise. Never push on the fly while it's being
discussed.

**Merge with `temple-bar merge <N>`.** It brings a branch that's behind
`main` up to date by merging `main` into it (never rewrite a pushed branch),
waits for the checks, refuses on open alerts, writes the squash message and
cleans up.

**One concern per pull request,** settled when the work is planned. The
`pre-push` size warning is the last check before the push: split the branch,
or say in the pull request why it is one concern.

**Commit messages**, and pull request titles and bodies, since a squash merge
turns them into the commit on `main`:

- A conventional prefix: `feat`, `fix`, `docs` or `chore`, with a scope where
  it helps (`fix(gate): ...`).
- Proportional to the change: one line for a small commit; for a phase, a
  subject plus one bullet per distinct concern.
- The subject names the change, never the trigger ("address feedback").
- **Squash merges get a written message,** never GitHub's default, which
  concatenates every commit on the branch. Subject: the pull request title
  with `(#N)`. Body: one bullet per distinct change (none if the title says it
  all), plain text readable in `git log`. Each co-author once, at the end.

## 3. Delegation

Delegate to keep the reviewer's context clean, not only to go faster. You own
the decision to parallelise; justify it, and never split work across
overlapping files.

- **Scopes.** Until scope locks exist, the plan's ownership list is the claim.
  Do not edit a file you have delegated until the subagent reports back.
- **Shared files** (root `package.json`, the lockfile, tsconfig, ESLint config)
  belong to the orchestrator. A subagent that needs a change there reports it
  instead of making it.
- **Subagents commit only.** Every merge, in any direction (including syncing a
  phase branch from its parent), and every push is the orchestrator's.
- **Done-conditions sit inside the subagent's scope.** "Report back with the
  known failure" is a valid ending.
- **The handoff report** has three parts: _resolved_, _deliberately deferred_,
  _needs a decision_. It includes break-it evidence for each new check, and
  answers "did you run anything outside your sandbox?".

## 4. Checks and review

CI is the merge condition, and CI runs the pinned `pnpm gate`, so the last
published temple-bar judges every pull request. `pnpm check` is the same gate,
kept as a familiar local alias.

- The full suite runs regardless of what changed. Never select tests by diff.
- Never weaken a check, suppress a rule, narrow an ignore list or skip a test
  to make it pass. Fix the cause, or argue that the check is wrong and change it
  deliberately in its own reviewed change.
- **Stop instead of loosening.** When a strictness conflict has no clean fix,
  stop and report it.
- **A refusal is a stop, not a detour.** When a sandbox, permission check or
  hook refuses something, stop and report. Never install anything globally
  (`npm i -g`, `corepack enable`, `brew install`) and never route around a
  refusal through the user's terminal.
- **Break-it evidence for every new check:** disable the fix, show the check
  fail with its own message (not git's or another check's), then restore it.
- **Diagnose before working around.** A workaround names its cause. "Flaky" is
  not a diagnosis: reproduce and name the cause, or report it as _needs a
  decision_.
- **Verified means exercised through the real delivery path.** For this repo
  that is the packed package installed from its tarball, not the source tree.
- **Say "passes locally; CI not yet seen"** until a CI run is green.
- Write tests that assert behaviour worth protecting. Do not pad the count.

**Review bar.** The orchestrator reads every line of a subagent's change before
it merges, lists what the change must defend against, and checks each item.
Rerunning the checks is not a review.

## 5. Architecture

- **File length** is capped in one config file and checked. That file is the
  only place the number appears. Split along existing seams; do not raise the
  cap.
- **Deep modules.** Simple interfaces over substantial implementations. Apply
  the deletion test: if deleting a module makes complexity vanish, it was a
  pass-through.
- **Seams** between domain logic and git, `gh`, the filesystem, the clock and
  user prompts, so tests can fake them.
- **Node built-ins only** for the machinery. Bash appears only as one-line hook
  shims that call Node.
- **Comments explain why, in plain words** a newcomer can follow. No internal
  plan IDs in code (`P3.1`, `D2`, "decision 23", "subtask 1.7"): state the
  reason itself, and point to an ADR when the full story matters. History
  belongs in git and ADRs, not in comments. TypeScript developers of every
  level read this code.

## 6. Blast radius

When a change touches many files, or several files in one directory, answer
once, out loud:

> Is one change spread across these files, or are these files doing the same
> thing as each other?

If the second: stop and fix the duplication instead of editing four copies.
Record the replacement as an ADR under `docs/adr/`, with the condition that
ended the old choice.

## 7. Sessions

Write state down in the issue whenever what the user says means work may stop:
a compact, a pause, a break, a usage limit. You judge when, from what they say.
Clear or compact only at a phase boundary, and ask first. On resume, read git,
open pull requests and the current issue rather than asking the user to remember.

## 8. Incidents

**Agents propose.** When something goes wrong (rework, confusion, a rule that
made things harder than needed, a rule broken), propose an incident, generously,
and ask the user there and then. On a yes, search temple-bar's issues: comment
on or update a similar one, or open one labelled `incident`. Never in another
project's repo, never with private details. No incident tool until theme F.

**The user curates.** Keeping, editing, closing and grouping incidents is
theirs. Never rank or regroup them.

**You remind them.** When you ask for a merge approval or report a merge, say
how many `incident` issues are open.

## 9. What is actually enforced

[docs/enforcement.md](docs/enforcement.md) lists which rules are blocked and
which are prose only; update it with any change to a mechanism. A rule that
drifts needs a mechanism, not stronger wording.

**Keep this file within 200 lines and 32 KiB.** Move reference material and
reasons to docs, such as [docs/agents-rationale.md](docs/agents-rationale.md);
don't cut rules to fit.
