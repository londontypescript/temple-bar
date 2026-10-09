# ADR 0007: What the gate checks

Date: 2026-10-01, updated 2026-10-03 and 2026-10-09. Status: accepted (decisions 10, 15, 20, 23, 36 and 43; 10 and 15
are recorded below with their implementation status).

## Context

`temple-bar gate` is the single check that decides whether a change may
merge: CI runs it, and the `main` ruleset requires CI. Whatever the gate
doesn't check is held by prose only. These decisions set what it requires of
a project, which tools it uses, and how it behaves.

## Decision

**Decision 23: the gate owns the checks.** The gate requires the project's
`typecheck`, `lint`, `test` and `format:check` scripts, and runs them all
every time. They are required as soon as the repo has content of its own,
whatever its language or file types, and a script that does nothing (such as
`echo ok` or `true`) fails. Which commands they run is the project's choice,
usually made by its agent from what's in the folder; temple-bar doesn't
supply a toolchain (decision 5).

- _Content of its own_ means any file beyond the ones a project starts
  with: what setup writes (`AGENTS.md`, `package.json`, `.gitignore`), the
  lockfile, `temple-bar.config.json`, and what GitHub offers to create with
  a new repository (`README.md`, `LICENSE`). Only those exact names at the
  top of the repo count as starting files; vendored or built folders
  (`node_modules`, `dist` and the like) and nested worktrees never count as
  content. No list of file extensions is involved.
- _Does nothing_ is a short, exact list: an empty command, `true`, `:`,
  `exit` or `exit 0`, a bare `echo ...`, or a chain made only of these. The
  message names the script and what belongs there. Subtler ways to weaken a
  script are left to the judge (planned), which will guard the scripts
  against later changes.
- Every required script that exists and does something runs, even when
  another is missing or does nothing, so one gap never hides another
  script's failures. The gate exits 2 when a script is missing or does
  nothing, and 1 for any other failure.

CI runs the pinned `pnpm gate` as the merge condition; `pnpm build`
stays a separate CI step. The repo's own duplicate length script went: see
[ADR 0001](0001-length-check-moves-into-the-gate.md) for that story. Before
this, the rules said the pinned gate was the merge condition while CI still
ran the source tree's own checks, the gate skipped `format:check`, and the
length cap was checked twice. Until 2026-10-03 "content" meant files with a
JavaScript or TypeScript extension, so a project whose code had other
extensions passed with none of its checks run; found by running the gate on
a `cargo init` project. Until then, too, one missing script stopped the
others from running, so a project's linter could go unrun until it had all
four scripts; found in the scaffolder trials.

**Decision 10: base-check tools.** gitleaks comes through a verified download
(a pinned version and SHA-256 per operating system, cached). npm tools
(markdownlint's library, knip) are package dependencies, pinned by the
lockfile. The library rather than the markdownlint-cli2 command: the gate
already lists the files, and the command's file matching brought in a
dependency with an unpatched flaw (Dependabot, 2026-10-03).
Built-in Markdown integrity checks cover actual local links and images,
including supported HTML references, and undefined explicit full/collapsed
reference labels. They do not require files mentioned only in inline code
to exist. Markdown style belongs to the project's `lint` and `format:check`.
The mandatory integrity set neither reads project Markdown style settings
nor honors generic markdownlint-disable directives. Escaped prose and code
examples are not interpreted as navigable links. Checks use Git-listed
targets and do not depend on the network for links.

This revised contract is implemented in source for the forthcoming
[0.0.10](../plans/0.0.10.md). The published 0.0.9 gate pinned in this
repository still runs broad Markdown lint and cited-path checks until a
separately approved release pin update. Fresh framework documents exposed the conflict between preserving
upstream instructions and enforcing universal style. Parsing corrections
preceded the policy change so comments and code examples do not create false
link failures. A custom rule reads the library's public structural tokens
for explicit references, sharing the interpretation used by local links.
This avoids stock reference-rule false positives for Unicode labels and
container prefixes. Packed delivery proves both genuine failures and
framework-document preservation. Section anchors, empty links, table-cell checks, duplicate
reference-label checks and MDX support are deferred; they need an explicit
rendering contract or evidence before becoming universal blockers.

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
