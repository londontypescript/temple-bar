# ADR 0013: No pre-merge-commit guard and no bypass ledger

Date: 2026-10-03. Status: accepted (decision 4;
[#60](https://github.com/londontypescript/temple-bar/issues/60)). Neither
was ever built, so nothing is removed from the code: this records why they
won't be.

## Context

The earlier hardening brief protected `main`'s history on the machine
itself, because that version merged locally. Two of its pieces were left
open when decision 4 replaced local merges with pull requests
([ADR 0003](0003-how-a-change-reaches-main.md)):

- a **pre-merge-commit guard**: a `pre-merge-commit` hook refusing a local
  merge into `main`;
- a **bypass ledger**: a record of every time someone overrode a guard on
  `main`'s history, so overrides stay visible.

Since then, local `main` can only move to commits already on `origin/main`:
the `reference-transaction` hook refuses anything else, and git runs it even
with `--no-verify`. On GitHub, the `main` ruleset accepts only squash merges
of pull requests.

## Decision

Both fail the deletion test, so neither is built.

**The pre-merge-commit guard adds nothing.** A local merge into `main` makes
a commit that isn't on `origin/main`, and `reference-transaction` already
refuses to move `main` to it. Its integration tests cover a local merge, a
local squash merge, a cherry-pick and a reset. A `pre-merge-commit` hook
would be weaker: `--no-verify` skips it. On any other branch, a merge commit
is the approved way to bring a branch up to date with `main`, so a guard
there would refuse the right thing.

**The bypass ledger has nothing to record.** It existed to make overrides of
the local-merge guard visible. There is no such override now:
`reference-transaction` has no switch to turn it off, and no message names a
way around it. The one bypass that can reach `main` is the maintainer's
bypass merge of a change to the checks
([ADR 0011](0011-which-checks-judge-a-pull-request.md)), and GitHub already
records that on the pull request. A local ledger couldn't see it, and a
skipped local hook leaves no trace for a ledger to catch anyway.

## What would end it

Revisit both if local `main` could again move to commits that aren't on
GitHub, for example if a "local merges" mode came back (decision 3 rules it
out), or if `reference-transaction` gained an override that someone could
use and should be seen using.
