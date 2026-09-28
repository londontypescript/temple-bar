# Agent directives

Binds every agent working here (Claude Code, Codex, Antigravity or any other)
and humans. This is the only copy of these rules. Harness config may duplicate
one to fail faster, never to replace it.

The plan and progress tracker is `docs/plans/temple-bar.md`. Its §1 is the
approved decisions list: check every brief and change against it.

## 0. This repo

- This repo is gated by the last published temple-bar. Its own source never
  runs as its tooling, and no feature exists to make it do so.
- Until 1.10, the local rules are prose only. Every change goes through a pull
  request.
- Bumping the pinned temple-bar version is a deliberate change in its own pull
  request, never a side effect of other work.
- The repo is public. Nothing committed here (code, plans, incident proposals,
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
That grouping carries their judgement of what matters. Do not reorder it by your
own priorities, and do not offer to generate it.

Update the tracker **at every subtask**, not at phase end. Until status tooling
exists, the plan's checkboxes are the status. A tracker that only moves at phase
end tells the user nothing about where to spend the rest of a usage window.

## 2. Branching

`main` changes only through merged pull requests.

- **Multi-phase plan:** `phase/<name>-N` → squash locally → `feature/<name>` →
  pull request → `main`
- **Quick change:** one branch → pull request → `main`
- **Never commit to `main`**, locally or on GitHub. A one-line fix gets a branch
  too. Local `main` only ever moves by fast-forwarding to `origin/main`.

The user merges every pull request, on GitHub or by saying yes so the
orchestrator runs `gh pr merge`. Ask before every merge, including local
phase → feature squashes. Agents push branches and open pull requests, never
`main`.

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

Until the gate exists, `pnpm check` (from subtask 1.2) and CI are the merge
condition. From 1.10, the pinned temple-bar gate is.

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
  fail, restore it.
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

- **File length** is capped in one config file (added in 1.2) and checked.
  That file is the only place the number appears. Split along existing seams;
  do not raise the cap.
- **Deep modules.** Simple interfaces over substantial implementations. Apply
  the deletion test: if deleting a module makes complexity vanish, it was a
  pass-through.
- **Seams** between domain logic and git, `gh`, the filesystem, the clock and
  user prompts, so tests can fake them.
- **Node built-ins only** for the machinery. Bash appears only as one-line hook
  shims that call Node.

## 6. Blast radius

When a change touches many files, or several files in one directory, answer
once, out loud:

> Is one change spread across these files, or are these files doing the same
> thing as each other?

If the second: stop and fix the duplication instead of editing four copies. A
decision that was right at prototype scale can quietly expire. Record the
replacement as an ADR under `docs/adr/`, with the condition that ended the old
choice.

## 7. Sessions

Clear or compact only at a phase boundary, only after writing state down, and
ask first. Usage limits cut work off mid-phase routinely; on resume, read git,
open pull requests and the plan's checkboxes rather than asking the user to
remember.

## 8. Incidents

The record is built in two halves, because neither of you has all of it.

**Agents propose.** When something goes wrong (rework, confusion, a rule that
made things harder than needed, a rule broken), add one line to the plan's
§6 in the next pull request. There is no incident tool until theme F. Propose
generously, with no project-private details.

**The user curates.** Keeping, editing, dropping and grouping proposals is
theirs. Never rank or regroup them.

**You remind them.** When you ask for merge approval and proposals are waiting,
say how many.

## 9. What is actually enforced

Stated plainly so nothing here is mistaken for a control. This table describes
the repo today, and changes as phase 1 lands.

| Rule                                      | Mechanism                               | Strength              |
| ----------------------------------------- | --------------------------------------- | --------------------- |
| `main` changes only through pull requests | GitHub ruleset on `main`                | **Blocked** on GitHub |
| No force-push or deletion of `main`       | GitHub ruleset on `main`                | **Blocked** on GitHub |
| CI passes before merge                    | required status checks, once added (U6) | **Blocked** from U6   |
| No commits to local `main`                | nothing until 1.10                      | **Prose only**        |
| Delegated file scopes                     | nothing until theme D                   | **Prose only**        |
| File length                               | nothing until 1.2                       | **Prose only**        |
| No weakened checks                        | nothing until theme B                   | **Prose only**        |
| Plan before code                          | nothing                                 | **Prose only**        |
| Tracker updated per subtask               | nothing                                 | **Prose only**        |
| Intake stays the user's                   | nothing                                 | **Prose only**        |
| Whether wide changes mean duplication     | nothing: judgement                      | **Prose only**        |
| Recording an incident at all              | nothing until theme F                   | **Prose only**        |

A rule that exists only as prose is a rule that will eventually be broken. If
you find one drifting, the fix is a mechanism, not stronger wording.
