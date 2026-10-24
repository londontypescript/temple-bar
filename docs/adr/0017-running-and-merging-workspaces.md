# ADR 0017: Running and merging a workspace, as built in 0.1.0

Date: 2026-10-24, recording decisions of 2026-10-15 and 2026-10-17. Status:
accepted (decisions 68 to 79 for 0.1.0;
[#366](https://github.com/londontypescript/temple-bar/issues/366)).

## Context

0.1.0 made temple-bar work at a pnpm workspace root: it finds every app and
shared package, runs each package's checks, and stops a pull request from
weakening them. What the judge guards in a workspace is decided in
[ADR 0015](0015-every-package-checked-and-guarded.md) (decisions 63 to 67).
The decisions here cover how the gate runs pnpm and starts itself, how a
workspace is merged, how 0.1.0 was built, and how this repo adopted it.

They were recorded in the [0.1.0 plan](../plans/0.1.0.md) and the plan's old
decisions list. Under decision 89
([ADR 0016](0016-agent-rules-and-the-merge-loop.md)) every decision has an ADR
as its home, so their approved text moved here unchanged; nothing new is
decided. The 0.1.0 plan stays as the record of how the milestone ran.

Decision 68 was settled on 2026-10-15 for phase 5, on
[#311](https://github.com/londontypescript/temple-bar/issues/311), with four
smaller points recorded there. Decisions 69 to 74 were approved on 2026-10-15
for the rest of 0.1.0, after ChatGPT Sol 6.1's adversarial review of the plan.
Decision 75 was approved on 2026-10-17, after the maintainer found real
installs on every pull request unsustainable and ChatGPT Sol 6.1 reviewed the
design. Decisions 76 to 79 were approved on 2026-10-17 for the 0.1.0 pin bump,
one at a time, after ChatGPT Sol 6.1 reviewed them adversarially.

## Decisions

**Decision 68: setup writes `ready`; the gate re-runs only the pnpm that
started it.** The gate re-runs only the pnpm named by `npm_execpath`, never
one from PATH. Setup writes a root `ready` script so `pnpm ready` hands that
path over.

**Decision 69: setup writes `merge`; `pnpm merge <N>` runs from the
default-branch checkout.** `temple-bar merge` runs the gate in-process too, so
setup writes a root `merge` script and the docs say `pnpm merge <N>`, run from
the default-branch checkout: it runs whatever the current folder's manifest
says, so never inside a pull request's worktree. The core check and the judge
make a changed `merge` script a failure; they don't protect the invocation
itself ([#401](https://github.com/londontypescript/temple-bar/issues/401)).

**Decision 70: the gate re-runs its starter in three launcher forms,**
resolved once for the listing and every script: a JavaScript entry through
`process.execPath`; a native executable on disk, run directly with no shell;
anything else (a `.cmd` shim, a path that doesn't exist) fails the inventory
and marks the root's scripts not run, with install advice. Whether the
standalone pnpm is supported is the maintainer's call after a probe of
`@pnpm/exe` ([#402](https://github.com/londontypescript/temple-bar/issues/402)).

**Decision 71: phase 6 builds to ADR 0015 as written.** `pnpm-workspace.yaml`
stays guarded whole (decision 66), and
[#285](https://github.com/londontypescript/temple-bar/issues/285) closes with
decision 64; the pull request carries a `One concern:` line.

**Decision 72: phase 6 is one builder.** Its packed judge tests are written by
a second subagent in a worktree of its own, after the orchestrator extends the
fake GitHub API to serve manifest contents, statuses and inconsistent file
lists, and integrated by the orchestrator.

**Decision 73: phases 6 and 7 build at the same time** in separate worktrees
and land in order; phase 8 follows.

**Decision 74: temple-bar generates no Knip configuration.** Knip runs once at
the root over the whole graph, and the gate attributes its findings to the
root or a package by path. Entries Knip's plugins don't find are declared in
the project's own Knip config. Current entry-export rules stay; stricter rules
need a later decision, and there are no broad entry globs or ignores
([#313](https://github.com/londontypescript/temple-bar/issues/313)).

**Decision 75: real-install tests form a release tier.** Tests whose cost
comes from installing real third-party frameworks form a release tier,
`pnpm test:release`, in `e2e/release/`, named so plain `node --test` never runs
them. Every pull request runs only `pnpm test`, where every promise keeps at
least one test on the minimal workspace; the release tier only confirms those
promises on a real stack. It runs by hand during a milestone (the
release-check workflow, dispatched on any branch), and the release workflow
requires it, on the six OS and Node pairs, before it stages a version on npm.
Its direct dependencies are pinned and their own dependencies resolve fresh,
so it is also a compatibility check against today's npm. The gate still
typechecks, lints, formats and runs knip over its files on every pull request.
Which test goes in which tier is a review rule, not a mechanism: the coverage
map in each pull request that adds release-tier tests is what the reviewer
checks.

**Decision 76: at the 0.1.0 pin, each package checks its own files.** Each
package gets its own `typecheck`, `lint`, `format:check` and `test`, with a
package `tsconfig.json` that includes its tests. The root's `test` runs
`scripts/` and `e2e/`; each package's runs its own `src/`. The root's
typecheck, lint and format checks stay whole-repo, so the packages' repeat
cheaply what the root checks whole, while each test file runs once. AGENTS.md
says the gate runs every test file, rather than that `pnpm test` runs in full.

**Decision 77: a test fails if a tracked test file is run by no test script,
or by more than one.** Test files are found by Node's own default naming. A
test script must be the runner, `--import` pairs, `--test` and double-quoted
patterns, each matching a file, separated by single spaces: any other flag,
shell syntax, line break or `!` is refused, since each could make the runner
run fewer files than the check credits.

**Decision 78: the standalone CI job runs `pnpm gate`** once the pin can start
standalone pnpm, under pnpm's native executable, so all three legs keep every
test and exercise the published gate itself.

**Decision 79: this repo merges with `pnpm merge <N>`** from the primary
checkout, never a pull request's worktree. The baseline refresh
([#422](https://github.com/londontypescript/temple-bar/pull/422)) landed
before the pin
([#423](https://github.com/londontypescript/temple-bar/pull/423)), so pull
requests from `main` pass its test again.

## What would end it

Decisions 71 to 73 set how 0.1.0 was built and ended with its release; they
stay as the record. Decision 75 would end if installing real frameworks on
every pull request became cheap enough to do, or if a promise could no longer
be tested on the minimal workspace. Decision 77 would end if the gate's own
check that every file is tested (decision 88) came to cover this repo's
stricter test selection, which ADR 0016 keeps separate for now.
