# ADR 0015: In a workspace, every package is checked and guarded

Date: 2026-10-11. Status: accepted (plan decisions 63 to 67 for 0.1.0;
[#311](https://github.com/londontypescript/temple-bar/issues/311),
[#312](https://github.com/londontypescript/temple-bar/issues/312),
[#285](https://github.com/londontypescript/temple-bar/issues/285)).

## Context

The gate reads the root `package.json` and runs its four scripts:
`typecheck`, `lint`, `format:check` and `test`
([ADR 0007](0007-what-the-gate-checks.md)). The judge guards the root's
`gate` and four scripts, its temple-bar pin, and pnpm's install settings
([ADR 0011](0011-which-checks-judge-a-pull-request.md)). In a pnpm workspace
that leaves every other package outside both. A trial on a small workspace
([#309](https://github.com/londontypescript/temple-bar/issues/309#issuecomment-6103677235))
showed three pull requests passing both gate and judge:

- one adding a package with no scripts
- one removing a package's `typecheck`
- one replacing it with `node --version`

Two gaps also exist at the root already, and every package multiplies them:

- **Delegation.** A guarded `test` can call an unguarded `test:unit`, which
  then changes freely.
- **Install-time scripts.** `preinstall`, `install`, `postinstall` and
  `prepare` run during CI's `pnpm install`, before the gate, and can replace
  the installed temple-bar. A workspace package's own `postinstall` runs on
  install too (checked with pnpm 10.34.5).

Codex reviewed the first design adversarially, and its findings shaped the
decisions below. The trial notes are at
[#366](https://github.com/londontypescript/temple-bar/issues/366).

## Decisions

**Decision 63: the same promise, in every package.** The judge guards the
files that decide whether and how the gate runs, now in every package, and
nothing more. It still does not cover:

- weakening inside the code, such as a skipped test or a disable comment
- tool configs other than `temple-bar.config.json` (decision 58)
- helper files a script calls
- what a script does while it runs
- where temple-bar's own dependencies' tarballs come from (see ADR 0011)

The weakening inside code and configs is
[#52](https://github.com/londontypescript/temple-bar/issues/52)'s to close,
in the gate, not the judge. The judge can say a file changed, not whether
the change made a check weaker.

**Decision 64: the judge guards every script of every tracked
`package.json`.** Any added, changed or removed script, in any manifest
outside `node_modules`, is a finding. Guarding the whole map closes
delegation and every install-time script without parsing shell commands.
Parsing would miss `npm-run-all`, `concurrently` and many shell forms. The
cost: changing any script, `dev` or `build` included, is the maintainer's
merge. The judge's record will show whether that is too often, as it did for
configs.

**Decision 65: a new package needs the maintainer.** An added `package.json`
with scripts is a finding, so each new target's first checks are reviewed.
The gate can only refuse obvious no-ops. `"test": "node --version"` passes
it, and a new package's scripts run in CI like any other. A deleted
manifest, or one renamed away, is a finding too: removing a package removes
its checks. A rename is judged as the old path deleted and the new one added.

**Decision 66: `pnpm-workspace.yaml` stays guarded as a whole file.** The
first design let its package list grow without the maintainer. That proved
unsafe:

- Adding a pattern can narrow what pnpm selects, by moving from pnpm's
  default list to an explicit one, or by adding a negation.
- Separating the list from the install settings needs a YAML reader in the
  judge.

After decision 65 every new package is the maintainer's anyway, so the split
would save no merges. A new folder under an existing pattern doesn't touch
this file.

**Decision 67: the gate checks every package, and checks its own list
against git.**

- The gate lists packages through the pnpm that started it (`npm_execpath`),
  never through a `pnpm` the project's PATH might shadow.
- It requires and runs the four scripts in each package's folder: the root
  first, then each package in path order. Every script runs, whatever the
  others return.
- A missing or obviously empty script fails the gate, naming the package.
- Any tracked `package.json` that is neither the root nor in pnpm's list
  fails the gate. That catches a package left outside the patterns, using
  evidence pnpm does not control. There is no exception list until a project
  needs one; if one is ever added, it belongs in `temple-bar.config.json`,
  which the judge guards.
- The root may still run all packages' checks from its own scripts. The gate
  doesn't depend on it.

## What the judge reads, and how it fails

These follow from the decisions, and need no separate choice:

- **Install settings.** The judge also guards the root's `packageManager`,
  `devEngines` and `pnpm` fields, and `.npmrc`, `.pnpmfile.*` and
  `pnpm-workspace.yaml` at any depth.
- **Fail closed.** Every manifest is read as absent, valid, invalid or
  unreadable, by the judge and by `ready` and `merge` alike. Unreadable never
  counts as absent, and invalid on the pull request's side is a finding.
- **GitHub's file list.** It must be complete and consistent: a whole-number
  count, distinct paths, and an exact match. The base and head commits are
  fixed before any file is read and checked again afterwards.
- **Unused code.** knip still runs once at the root, where it sees every
  package. Entry exports are judged as they are today. A project whose
  entries knip's plugins don't find declares them in its own knip config,
  which decision 58 leaves to the project.

## Consequences

- Each new target, and each script change, is an admin merge. Ordinary code
  changes inside packages are not.
- When this repo pins 0.1.0, `packages/temple-bar` and
  `packages/create-temple-bar` each need the four scripts.
- [#285](https://github.com/londontypescript/temple-bar/issues/285) closes
  with decision 64.

## The failure each promise stops

Phases 5 and 6 add a test for each of these.

| Pull request                                                  | Stopped by  | Decision      |
| ------------------------------------------------------------- | ----------- | ------------- |
| Adds a package with no scripts                                | gate        | 67            |
| Removes a package's `typecheck`                               | gate, judge | 64, 67        |
| Replaces a package's `typecheck` with `node --version`        | judge       | 64            |
| Changes an unguarded `test:unit` that `test` calls            | judge       | 64            |
| Adds a `postinstall` to any package                           | judge       | 64            |
| Adds a package whose scripts are real but weak                | judge       | 65            |
| Deletes a package, or renames it away                         | judge       | 65            |
| Adds a negation to `pnpm-workspace.yaml`'s package list       | judge       | 66            |
| Leaves a tracked `package.json` outside the workspace list    | gate        | 67            |
| Puts a `pnpm` on the project's PATH that lists fewer packages | gate        | 67            |
| Sends a GitHub file list that is truncated or repeats a path  | judge       | (fail closed) |

## What would end it

- If the judge's record shows script changes making admin merges routine,
  decision 64 narrows to the scripts the gate runs plus install-time
  scripts, and delegation gets another answer.
- If a project needs a package outside pnpm's workspace list, decision 67
  gains an exception list in `temple-bar.config.json`.
- If pnpm ever gives a list of workspace packages that the judge can read
  without running the pull request's code, decision 66 can be revisited.
