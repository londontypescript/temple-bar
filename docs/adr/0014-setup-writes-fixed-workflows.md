# ADR 0014: Setup writes fixed workflows, and the gate keeps them exact

Date: 2026-10-07. Status: accepted (plan decisions 3, 11, 12 and 14 for
0.0.9;
[#191](https://github.com/londontypescript/temple-bar/issues/191), which
also takes up incident
[#109](https://github.com/londontypescript/temple-bar/issues/109)).

## Context

A new project now starts from a framework scaffolder, then temple-bar setup
([#194](https://github.com/londontypescript/temple-bar/issues/194)). The
gate's CI used to come from the temple-bar-template repo, which is retired,
so setup no longer supplies a workflow that runs the gate. A scaffolder may
bring CI of its own, but nothing runs the pinned gate on a pull request.

Setup already writes one workflow, the judge
([ADR 0011](0011-which-checks-judge-a-pull-request.md)), and writes it only
when the file is missing. The judge fails any pull request that changes a
workflow, so a change to CI is already the maintainer's to review. What the
judge can't say is whether the change broke something that matters: it
fails a new job and a deleted gate step alike.

## Options

1. **Write `ci.yml`, and check named invariants in it** (the first draft):
   the gate step runs `pnpm gate` after a frozen install, has its token,
   can't be skipped, and so on, while projects edit the rest of the file.
   Codex's adversarial review of that draft showed the invariants can all
   hold while the gate never really runs: a `shell:` that runs `true`, a
   default `working-directory` pointing at a fixture, checkout of `main`
   instead of the pull request, `needs:` on a skipped job, or an earlier
   step that puts a fake `pnpm` on the PATH. While other steps share the
   job, checking the text of one step can't prove what it runs, and a YAML
   library wouldn't change that. temple-bar also has no YAML parser, and
   its machinery uses Node built-ins only (AGENTS.md §5).
2. **A fixed gate workflow, checked as an exact copy.** Projects never edit
   it; their own jobs go in workflows of their own. Each job runs on a
   fresh runner, so nothing in another workflow can change what the gate
   job runs. No YAML reading at all.

## Decision

**Option 2,** for two workflows: the gate, and the pull request title
check.

### Setup creates missing workflows and upgrades authentic earlier output

- **The file:** `temple-bar-gate.yml` in `.github/workflows/`, beside
  `temple-bar-judge.yml`. The name says it's temple-bar's, not the
  project's general CI.
- **Create missing copies and upgrade authentic earlier output.** The
  approved 0.0.10 repair recognizes exact published hook and workflow
  identities ([ADR 0005](0005-setup-hooks-and-worktrees.md)). An edited or
  unrecognized workflow is preserved: setup names the first differing line
  and the fix, then ends non-zero. That includes a conflicting judge copy,
  without adding a new judge-copy gate check. The gate and title copies
  still fail their existing exact-copy check until they match. No other
  workflow is touched, and a project's own `ci.yml` stays its own.
- **Its text lives in the package** as one function beside
  `judgeWorkflow()`, so the copy setup writes is the one this version was
  tested with. It opens with a comment saying it's written by temple-bar,
  checked as an exact copy by the gate, and that the project's own jobs go
  in a workflow of their own. It is Prettier-clean, since a project's
  format check usually covers YAML.
- **Contents:**
  - `on: pull_request`, types `opened`, `synchronize`, `reopened`; no
    `push` trigger.
  - `permissions: contents: read`; a `concurrency` group that cancels a
    superseded run on the same pull request.
  - One job, with no `if:` and no `timeout-minutes`, on `ubuntu-latest`
    with Node 24, the judge's
    version. Its `name:` is the check name a ruleset requires, so it comes
    from a constant that the workflow text, setup and the gate share
    ([#286](https://github.com/londontypescript/temple-bar/issues/286)
    requires it on the default branch).
  - Steps: checkout (pinned by hash, no persisted credentials, full history
    for the size check), pnpm, Node with the pnpm cache,
    `pnpm install --frozen-lockfile`, `pnpm gate` with
    `GH_TOKEN: ${{ github.token }}`, then `pnpm exec temple-bar pr-size`.
    The workflow only runs on pull requests, so the size step needs no
    `if:`, and it runs normally: a size warning exits 0, and a measurement
    or usage error fails as it does anywhere else.
  - No step, job or workflow has `if:` or `continue-on-error`.
  - Actions pinned to full commit hashes, from constants shared with the
    judge workflow. temple-bar's own `.github/workflows/ci.yml` is written
    by hand and keeps its own copy of the hashes.

- **Names, reserved for temple-bar:** the gate job is `temple-bar gate`
  and the title job is `temple-bar pr-title`, exported as `GATE_CHECK` and
  `PR_TITLE_CHECK` with the paths as `GATE_WORKFLOW_PATH` and
  `PR_TITLE_WORKFLOW_PATH`. Each workflow's opening comment says its job
  name is reserved: a project's own jobs use other names. The gate's
  report line for the exact-copy check is `gate and title workflows`.

### Setup also writes the title workflow

A pull request's title becomes its squash commit's subject on `main`, so it
must follow the commit message format. The commit message hook can't see
it: the title is written on GitHub. The old template checked it inside its
CI; nothing checks it in a project set up today, and `temple-bar merge`
doesn't either.

- **The file:** `temple-bar-pr-title.yml` in `.github/workflows/`, written and
  checked exactly like the gate workflow.
- **Its own workflow,** as in temple-bar's own repo: it runs on `edited`
  too, so a changed title is checked again, and that must not rerun the
  whole gate when only the description changed. It runs on every edit,
  even one that left the title alone, because a skipped check counts as
  passed.
- **Contents:** the same checkout (default depth), pnpm, Node and frozen
  install, then `pnpm exec temple-bar pr-title`, in one job with a
  10-minute timeout whose name is a shared constant too. Its concurrency
  group is its own, so a title edit never cancels a gate run.

### Setup names the pnpm version when nothing does

`pnpm/action-setup` installs the pnpm version `package.json` names
(`packageManager`, or `devEngines.packageManager`, which wins), and fails
when nothing names one. It also fails when the workflow names a version
that differs from the project's. So the workflows name none, and the
project stays the only place the version is set:

- When neither field names a pnpm version, setup adds
  `"packageManager": "pnpm@<version>"`, the version of the pnpm running
  setup, read from `npm_config_user_agent`.
- An existing value is never changed. One setup can't use (empty or blank,
  not a string, or another package manager) is reported as a conflict,
  and the run ends non-zero. Both fields are checked: a valid pnpm
  `devEngines.packageManager` beside a `packageManager` naming another
  tool is a conflict too, because pnpm can refuse to run a project whose
  `packageManager` names another package manager.
- The running pnpm's version is read as an exact SemVer version. When
  setup can't tell which pnpm is running it, it writes no version, says to
  rerun it through pnpm, and the run ends non-zero: the workflows can't
  install pnpm without a version. It never guesses. Setup's other files
  are still written.

This narrows [ADR 0005](0005-setup-hooks-and-worktrees.md), which says
setup never chooses or writes the project's toolchain: setup now records
the pnpm version already running it, and only when the project names
none. Choosing any other part of the toolchain stays the project's. The
judge doesn't yet guard these fields
([#285](https://github.com/londontypescript/temple-bar/issues/285)).

### The gate checks each file is an exact copy

- The gate compares each fixed workflow with the text this version
  writes, byte for byte apart from line endings: one check, over a list
  of the two files.
- **Missing file:** the gate fails and says to run setup again. A project
  that deletes one has lost that check in CI; the judge stops
  that pull request, and the gate keeps saying so afterwards.
- **Different file:** the gate fails, names the first line that differs,
  and says to move the project's own changes into a workflow of their own
  and restore the file by running setup again.

### Where each piece sits in the defences

- **On a pull request, the judge fails any change to the gate workflow**
  (ADR 0011). A pull request that removes the gate step doesn't run the
  gate in its own CI, so the judge is what stops it there.
- **Before the push, the gate catches it.** `temple-bar ready` and
  `pnpm check` run the full gate, so a broken gate workflow is reported
  before anything leaves the machine.
- **After a merge,** every later gate run keeps failing until the file is
  restored, which the judge alone can't do.
- **What this doesn't cover:** code that runs during install. A changed
  `prepare` script can replace the installed temple-bar before the gate
  runs, and the judge doesn't guard `prepare` yet
  ([#285](https://github.com/londontypescript/temple-bar/issues/285)).
  This decision protects the workflow's text; the judge and the install
  settings protect the rest.

## Not in this decision

- **Other workflows** (release, deploy). Incident #109's "every publishing
  job needs the full CI first" applies to workflows setup doesn't write.

The original 0.0.9 decision deferred updating earlier generated workflows.
The approved 0.0.10 historical-upgrade repair above ends that deferral:
genuine published copies can be replaced without licensing edits or unknown
newer content. The workflow templates and gate's exact-copy policy remain
unchanged. The repository continues to use its pinned 0.0.9 until a separate
release pin update.

## What would end it

- GitHub's "require workflows to pass" ruleset on standard plans
  (ADR 0011, option 1) would let a trusted copy of the workflow run from
  outside the pull request, together with whatever still guards the pin,
  the scripts and the install settings.
- If projects routinely need to change the gate job itself (another OS,
  another Node version), an exact copy is wrong for them: give the gate
  workflow named settings that setup writes and the gate checks, and
  revisit this decision.
