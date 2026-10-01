# ADR 0004: Which GitHub settings temple-bar applies

Date: 2026-10-01. Status: accepted (decisions 25, 34 and 40; 34 is decided
but not built yet).

## Context

Much of temple-bar's enforcement happens on GitHub, not on the machine: the
`main` ruleset refuses direct pushes, merge commits and changes that fail
their checks. GitHub has many more settings than the workflow needs, and a
tool that manages all of them becomes a different product. These decisions
fix which settings temple-bar touches.

## Decision

**Decision 25: CodeQL is a required check on the `main` ruleset.** A pull
request can't merge while code scanning fails, the same as CI.

**Decision 34: the same GitHub rulesets on every London TypeScript repo,
including signed commits.** Setup applies them, and the gate checks they are
still in place, so a ruleset loosened by hand is noticed. This was tested on real
GitHub on 2026-10-01: a squash merge made by GitHub is signed, but a rebase
merge made by GitHub is not. So every repo merges by squash only (decision 17,
settled in [#121](https://github.com/londontypescript/temple-bar/issues/121)),
and the rulesets require signed commits. This repo's ruleset has done so since
2026-10-01. Setup applying it to other repos is not built yet:
[#45](https://github.com/londontypescript/temple-bar/issues/45).

**Decision 40: temple-bar enforces the workflow; it isn't a general GitHub
settings manager.** It applies and checks a short, fixed list of settings
through `gh`: the ones the workflow depends on. Anything beyond that list is
out of scope.

## What would end it

This is wrong if the workflow comes to depend on more GitHub settings than a
short fixed list can hold. If more is ever needed, temple-bar adopts
safe-settings rather than growing its own settings manager.
