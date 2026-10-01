# ADR 0007: What the gate checks

Date: 2026-10-01. Status: accepted (decisions 10, 15, 20, 23, 36 and 43; 10 and 15
are decided but not built yet).

## Context

`temple-bar gate` is the single check that decides whether a change may
merge: CI runs it, and the `main` ruleset requires CI. Whatever the gate
doesn't check is held by prose only. These decisions set what it requires of
a project, which tools it uses, and how it behaves.

## Decision

**Decision 23: the gate owns the checks.** The gate requires the project's
`typecheck`, `lint`, `test` and `format:check` scripts, and runs them all
every time. CI runs the pinned `pnpm gate` as the merge condition; `pnpm build`
stays a separate CI step. The repo's own duplicate length script went: see
[ADR 0001](0001-length-check-moves-into-the-gate.md) for that story. Before
this, the rules said the pinned gate was the merge condition while CI still
ran the source tree's own checks, the gate skipped `format:check`, and the
length cap was checked twice.

**Decision 10: base-check tools.** gitleaks comes through a verified download
(a pinned version and SHA-256 per operating system, cached). npm tools
(markdownlint-cli2, knip) are package dependencies, pinned by the lockfile. A
built-in link check covers local links and cited paths only, so the gate
never depends on the network for links. Not built yet (theme B).

**Decision 15: the target matrix.** Each project declares its delivery paths,
each with an end-to-end check. The gate runs them all, won't accept the
unit-test command as a target check, and requires at least one target once
code exists. Unit tests passing doesn't show the delivered thing works: here,
only the test that installs the packed package from its tarball proves the
published package runs from `node_modules`. grand-union v2 is the first user;
temple-bar doesn't use it on itself. Not built yet (theme B).

**Decision 20: gate behaviour.** `--help` on any command shows help and runs
nothing, and a passing gate lists the checks that ran, so a pass shows what
it actually covered.

**AGENTS.md size (decision 36, recorded in
[ADR 0009](0009-readme-and-agents-md.md)).** The gate enforces it. A repo with
no AGENTS.md skips the check (reported as skipped) rather than failing: setup
writes one, and a docs-only or mid-setup repo must still be able to pass.

**Ruleset (decision 43, recorded in
[ADR 0004](0004-github-settings-temple-bar-applies.md)).** The gate reads the
default branch's active rules from GitHub and fails if a rule that setup
creates is missing, or looser (for example merge commits allowed again).
Extra rules a repo adds are fine. It supports public repos only: a private
repo is skipped with a stated reason. It reads GitHub with Node's `fetch`,
not `gh`. A `GH_TOKEN` or `GITHUB_TOKEN` is used when present. In GitHub
Actions one is required (`GH_TOKEN: ${{ github.token }}` on the gate step,
no extra secret): anonymous calls are limited to 60 an hour per IP, shared
runners often use that up, and a check that fails at random teaches people to
ignore it, so without a token it fails every time with that fix. Offline or unreachable GitHub is skipped on a laptop, with
the reason shown, but fails in GitHub Actions, where a silent pass would hide a
loosened ruleset.

**Which copy of the checks judges a pull request.** The earlier hardening
plan said `main`'s copy of the checks should judge every change, so a pull
request can't weaken the checks that judge it. That is still needed, but pull
request CI runs the pull request's own copy of the workflow, so it needs its
own design (theme B).

## What would end it

This is wrong if a London TypeScript project can't express its checks as
these four scripts plus declared targets, for example a project whose real
delivery path can't be exercised end to end in CI. Then the gate would need a
way to accept another kind of check without letting a project skip one.
