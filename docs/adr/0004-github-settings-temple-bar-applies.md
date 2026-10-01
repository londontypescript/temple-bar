# ADR 0004: Which GitHub settings temple-bar applies

Date: 2026-10-01. Status: accepted (decisions 25, 34 and 40).

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
2026-10-01. The ruleset setup creates on a new repo now contains: no deletion,
no force push, a pull request required with 0 approvals and squash as the
only merge method, linear history and signed commits. It targets the
default branch with no bypass. Requiring branches to be up to date waits for
the judge ([ADR 0011](0011-which-checks-judge-a-pull-request.md)): GitHub's
rule only acts on named required checks, and setup can't know a repo's check
names until it installs the judge's
([#148](https://github.com/londontypescript/temple-bar/issues/148)). The definition lives in one place,
`rulesetBody()` in `github-ruleset.ts`. The gate's check that these rules are
still in place is not built yet
([#45](https://github.com/londontypescript/temple-bar/issues/45)). When it is,
it supports public repos only: on a private repo CI's default token can't read
rulesets (that needs the Administration read permission), so that case is
decided when the first private London TypeScript repo comes along.

Creating the ruleset, like creating the repo, needs the user's yes. At a
terminal setup asks. An agent without one asks the user in chat and reruns
setup with `--create-ruleset` (or `--create-repo`), each flag answering only
its own question.

**Decision 40: temple-bar enforces the workflow; it isn't a general GitHub
settings manager.** It applies and checks a short, fixed list of settings
through `gh`: the ones the workflow depends on. Anything beyond that list is
out of scope.

## What would end it

This is wrong if the workflow comes to depend on more GitHub settings than a
short fixed list can hold. If more is ever needed, temple-bar adopts
safe-settings rather than growing its own settings manager.
