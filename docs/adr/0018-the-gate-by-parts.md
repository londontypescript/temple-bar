# ADR 0018: The gate by parts

Date: 2026-10-27. Status: accepted (decision 90 for 0.3.0;
[#463](https://github.com/londontypescript/temple-bar/issues/463)).

## Context

Every pull request waits for the slowest of this repo's three Windows legs
(`check` on two Node versions, and `standalone`), and each runs the whole
gate: the root's scripts, then each package's, one after the other. On
Windows the gate step takes 15 to 20 min.

The gate already falls into parts that need nothing from each other: the
repo-wide checks, the root's scripts and each package's scripts. Run as
separate jobs, they finish side by side. Under the performance rule, a frozen benchmark came first: on a throwaway
branch, three rounds started both arms together on Windows runners. The time
until all three Windows legs finish dropped from a median of 20.9 min to about
11.5 min (target: at least 4 min faster), with at most 0.1 min of queueing per
job (limit: 2 min). The result is recorded on
[#463](https://github.com/londontypescript/temple-bar/issues/463#issuecomment-6449461080).

Running the parts as separate jobs only helps if something proves afterwards
that they were the whole gate, all of it, on the same commit, and that it
passed: otherwise a part left out, run twice, run on another commit or with
another tool would pass unseen. That proof is what this decision adds to the
gate; the CI side follows in a later phase.

Decision 78 ([ADR 0017](0017-running-and-merging-workspaces.md)) has the
standalone leg run the published gate under standalone pnpm. This extends it:
the standalone leg's parts still run the published gate under standalone
pnpm, and the verifier checks they did.

## Decision

**Decision 90: the gate runs by parts, from one check plan, and verifies
that the parts add up to the whole gate.**

- **One check plan.** Every check the gate runs is an entry in one plan, in
  today's order, tagged with the part it belongs to: `repo` (every check that
  isn't a package's scripts: the workspace inventory, coverage over the whole
  workspace, setup's core, the workflow copies, the file-length cap, the
  AGENTS.md size, markdown lint, links, unused code and the ruleset checks),
  `root` (the root's four scripts), and one part per workspace package, named
  by its folder relative to the root as the inventory gives it. The whole gate
  runs every entry; `temple-bar gate --part <name> --leg <leg> --report
<file>` runs one part's entries through the same code, with the same skips,
  outcome names and messages. No check can exist in only one of the two.
- **Exact outcomes.** Each entry declares the outcome names it reports
  whatever happens (coverage always reports two, the ruleset checks four, skip
  and error paths included), so each part's exact outcomes are known from the
  plan before anything runs. Every run checks it reported exactly that set.
- **Exit codes** per part are the whole gate's, applied to that part's
  outcomes: 2 if a required script in it is missing or does nothing, else 1 if
  any outcome failed, else 0.
- **Reports.** A part writes a versioned JSON report (format, version,
  repository, commit, run and attempt, leg, Node version, how pnpm ran, the
  gate's version, the part, its exit code and every outcome) after its checks,
  pass or fail. It is created exclusively: a file already at that path is
  refused, never overwritten.
- **The verifier.** `temple-bar gate --verify-parts <folder> --leg <leg>`
  works out the expected parts and each one's outcomes itself, from its own
  inventory and the same plan, never from the reports. It passes only when the
  folder holds exactly one well-formed report per part (only regular `.json`
  files, read strictly), each matching its own repository, commit, run,
  attempt, leg, Node, pnpm and gate, with exit code 0, no outcome the whole
  gate counts as failing, and exactly that part's outcome names, once each. It
  reports every problem it finds, not just the first.
- **Strict options.** Exactly three forms are accepted: no options (the whole
  gate), part mode with all three options, and verifier mode with its two;
  anything else, including an argument the gate used to ignore, exits 1 with
  `gate: <reason>` (2 already means a missing script).
- **Actions only.** Both split modes refuse to run outside GitHub Actions
  (they need `GITHUB_ACTIONS=true`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID` and
  `GITHUB_RUN_ATTEMPT`) and need the gate started through pnpm, since the
  report records how pnpm ran. A workspace package whose folder is `repo` or
  `root` can't be split, since its report couldn't be told apart; the whole
  gate is unaffected.
- **`ready` and `merge` keep the whole gate,** always called with no
  arguments.

**Independence is the stated condition of the split mode.** Today coverage
and Knip run after every package's scripts, in the same checkout; in a split
run the `repo` part runs in a fresh checkout. A split gate equals the whole
gate only if no script's side effects change another part's result. That
holds for this repo's scripts (none generates files the other checks read;
`pnpm build` runs after the gate), and nothing enforces it: `ready` and
`merge` keep the whole gate, which has no such condition.

**What the verifier does not prove.** It trusts reports produced in its own
run: it proves completeness and agreement, not that a job wasn't tampered
with. The CI side (one artifact per part, only this leg's, and a verifying
job that fails unless every part job succeeded) is the next phase of #463.

Rejected:

- Sharding test files across jobs: the gate's own parts need no new way to
  split a test suite, and the benchmark showed they are enough.
- Listing each part as a required check in the ruleset: the ruleset would
  change with every package added; the verifier proves completeness instead.
- Taking the expected parts or outcomes from the reports: a report left out
  would then shrink what is expected.

## What would end it

- If a script's side effects come to change another part's result (a script
  that generates files coverage or Knip reads), the split gate would no longer
  equal the whole gate, and the split mode would need the parts to share a
  checkout, or end.
- If the Windows legs become fast enough that one job per leg no longer
  holds up pull requests, the split mode could go, with its CI jobs.
- If a part's report needs to be trusted beyond its own run (for example
  reused across runs), the verifier would need a way to prove where a report
  came from, which it doesn't have.
