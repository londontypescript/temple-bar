# ADR 0003: How a change reaches `main`

Date: 2026-10-01. Status: accepted (decisions 4, 17, 18, 24, 33 and 35; 33 and
35 are decided but not built yet).

## Context

An agent that used branches all day can still commit straight to `main` after
a long session or a context reset. The earlier version of this workflow
merged locally, and its brief had several items about protecting `main`'s
history on the machine itself. These decisions replace that with one pipeline:
a branch, a pull request, a merge on GitHub, and nothing else.

## Decision

**Decision 4: `main` changes only through merged pull requests** (GitHub
flow). The `main` ruleset on GitHub refuses anything else. Locally, a
`pre-commit` hook refuses commits while `main` is checked out, and a
`reference-transaction` hook lets local `main` move only to commits already on
`origin/main`, which `git commit --no-verify` does not skip. Agents push
branches and open pull requests, never `main`.

This largely replaces the earlier brief's items on `main`'s history and its
pre-merge-commit guard. Whether that guard and the brief's bypass ledger still
add anything is re-checked in theme C, and whichever fails the deletion test
goes.

**Decision 35: push once, when finished.** Every push to a pull request costs
a full CI run, so a branch is pushed only when its work is final: agreed with
the maintainer for changes that need their yes (AGENTS.md, plan decisions, the
README), or finished by the agent otherwise. The planned mechanism is a
`pre-push` hook that refuses a push until `temple-bar ready` has marked the
current commit; any new commit clears the mark, and changes that need the
maintainer's yes need their confirmation typed in a terminal. Known limits:
`git push --no-verify` skips the hook, and a cloud agent with no terminal
needs another way to get the confirmation, still to be designed. Not built
yet: [#65](https://github.com/londontypescript/temple-bar/issues/65). Until
then, AGENTS.md §2 states the rule as prose.

**Decision 24: commit messages.** Conventional prefixes (`feat`, `fix`,
`docs`, `chore`, with a scope where it helps), proportional to the change,
naming the change and never the trigger. The same applies to pull request
titles and bodies, because a squash merge turns them into the commit on
`main`. A squash merge gets a written message, never GitHub's default, which
concatenates every commit on the branch.

**Decision 17: squash merges only.** Every pull request lands on `main` as one
squash commit, which GitHub creates and signs, with the pull request's title
and number as its subject. A multi-phase plan gets one pull request per phase,
merged in order, and a release is a milestone and a tag. The `main` ruleset
allows only squash merges and requires linear history and signed commits; the
repo's settings switch off merge commits and rebase merges too.

Until 2026-10-01 a multi-phase feature was rebase-merged so each phase stayed
its own commit, as both earlier templates kept phase commits on `main`. But
GitHub doesn't sign the commits a rebase merge rewrites, so requiring signed
commits (decision 34) would have refused them (#121). Squash only keeps one
commit per phase by giving each phase its own pull request, matching
TypeScript, Vite, React and most large TypeScript projects. The cost is a few
more CI runs per release, because each pull request must be up to date with
`main` before it merges.

The very first version had a merge-method rule only as words inside its
local-merge steps, so decision 4 removed it along with that mechanism, and the
first two pull requests here landed as merge commits. The ruleset now refuses
them outright.

**Decision 18: who merges.** The orchestrator (the agent running the work)
merges a pull request once CI and CodeQL are green. A pull request that
changes AGENTS.md, bumps the pinned temple-bar, tags or publishes needs the
maintainer's yes first. This keeps the maintainer's attention for the changes
that alter the rules or reach users. The decision first said "Claude"; it
says "the orchestrator" today because harnesses stay neutral (decision 31).

**Decision 33: `temple-bar merge` does the whole merge.** It waits for CI and
CodeQL, refuses while code-scanning alerts are open, merges with a written
squash message, then removes the worktree and the local branch and confirms
the remote branch is gone. It blocks until done, so it works under any
harness, including one that can't be woken when checks finish. Not built yet:
[#64](https://github.com/londontypescript/temple-bar/issues/64). Until it
ships, AGENTS.md §2 states these steps as prose.

## What would end it

This pipeline is wrong if GitHub pull requests stop being the place where
checks run and merges are recorded, for example if required checks could no
longer block a merge. It would also need revisiting if CI became cheap enough
that pushing often cost nothing, which would remove the reason for pushing
once.
