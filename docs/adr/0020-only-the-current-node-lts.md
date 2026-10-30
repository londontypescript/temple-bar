# ADR 0020: Only the current Node LTS

Date: 2026-10-30. Status: proposed (decision 99, for 0.3.0 and 0.4.0).

## Context

temple-bar has supported Node 24 and newer since its first releases
(decision 9), and setup declares the same floor in every project it sets up
(decision 60). CI runs this repo's whole suite on Node 24 and on Node 26:
`check` on three operating systems for each version, with Windows split into
four parts.

Node 26 became LTS this month; Node 24 stays in maintenance until April 2028.
Testing both costs 7 of `ci.yml`'s 21 jobs and about a third of its runner
minutes. Over nine recent runs, the wait would fall by only 1 to 2 minutes of
about 17, because the slowest jobs (Windows `part root`, macOS `check`) run
whatever the Node version.

Today one maintainer is temple-bar's only user, in the London TypeScript
organisation's repos and their own. No outside project depends on Node 24
support, and every project picks up a new floor only when it bumps its pin.

This repo is checked by the published temple-bar it pins, which insists the
workflows setup wrote match that release's own copies. So a release can't
raise the floor and move those workflows at once: its own pull request would
run the packed package, refusing Node 24, from a workflow still on 24.

## Decision

**99. temple-bar supports only the current Node LTS, and moves up after each
new LTS.**

- **The floor is the newest Node LTS.** `engines.node` in the root
  `package.json` and both packages, `MIN_NODE_MAJOR` in both packages'
  `node-version.ts`, and the floor setup declares (decision 60's rule of
  raising a lower floor stands).
- **CI runs one Node version,** the newest LTS, on every leg, including the
  workflows setup writes and the release workflows.
- **A move takes two releases:**
  1. CI and the workflows setup writes move to the new LTS, and each
     workflow's last published output is registered so setup replaces it.
     The floor stays. This repo's pin bump then moves its own workflows,
     with the pin, in one admin-merged pull request.
  2. The floor rises.
- **When:** after a new even-numbered Node becomes LTS (each October) and
  passes these checks. The first move is 24 to 26: step 1 in 0.3.0, step 2 in
  0.4.0.
- Newer Node versions stay allowed by `>=` but untested, as today: the floor
  is the minimum supported version.

Supersedes the "Node 24+, CI on Node 24 and 26" part of decision 9, and the
version in decision 60.

## Consequences

- One Node leg: `ci.yml` goes from 21 jobs to 14, Windows from 15 to 10, with
  about a third fewer runner minutes. The wait barely changes.
- The `main` ruleset's required checks must lose the retired Node version's
  names before step 1's pull request merges: that pull request never runs
  them, and the ruleset has no bypass. Once its new-version checks are green,
  the maintainer removes only the retired names (the new ones are already
  required), admin-merges, and checks the ruleset. To roll back, put the
  names back and revert.
- Anyone below the floor is refused with the existing clear message before
  setup changes anything. Today that's only the maintainer's Windows test
  machine, which needs Node 26 before 0.4.0's checks.
- A project moves when it bumps its pin. Its pull request must carry the pin,
  the lockfile, the regenerated workflows and `engines.node` together,
  prepared on the new Node, and it's admin-merged because the judge refuses
  it. A project's own CI jobs, which setup doesn't touch, need checking too.
- Every move costs two release steps. Skipping one October leaves temple-bar
  on the previous LTS, still supported, but each LTS has an end-of-life date
  (Node 24's is April 2028): a deferral records that date.

## Rejected

- **Keep every live LTS (24 and 26).** The usual choice for a public library,
  but it buys nothing while no project needs the older LTS, and each moves only with its pin.
- **Stop testing 24 but keep `>=24` for good.** It saves the same 7 jobs with
  no migration, and it's what 0.3.0 does on the way. Kept permanently, it
  would promise a version nothing tests.
- **One release per move.** Impossible here: the pinned gate guards the
  setup-written workflows (Context).
- **Patch releases for the move** (0.2.3, 0.2.4). Eight extra pull requests of
  release steps, and decision 2 puts planned changes in minor releases.
- **Pin an exact Node version** (a `.node-version` file, or pnpm managing
  Node per project). Out of scope: it changes how contributors install Node.

## What would end it

- An outside project, or a contributor's platform, needs an older LTS.
- A new Node LTS breaks a dependency temple-bar can't drop, so the move waits.
