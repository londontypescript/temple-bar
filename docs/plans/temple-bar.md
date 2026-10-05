# Plan: temple-bar

Status: **Layer 1 (phase 1) DONE 2026-09-29. The 0.0.3 mini plan (§3a) DONE 2026-09-29: 0.0.3 is on npm as `latest`, and CI here runs the published 0.0.3 gate.** Since 2026-10-01, what comes next and its progress are [GitHub issues](https://github.com/londontypescript/temple-bar/issues) (decision 37, §3b).

Approval is in two layers, as agreed:

1. **Layer 1: Phase 1 (stage0)** is fully detailed below. Approving it lets the build start.
2. **Layer 2: later phases** are outlined only, each marked with what it's waiting on. Each one gets detailed and approved before it starts.

Inputs, kept outside this public repo in the user's local v1 repo (`nnsee-agentic`) and only read, never copied in: the brief (P1–P9, §4), the incident intake beside it (IDs X = another project, G = grand-union, N = nnsee-agentic), and the frozen hardening plan (D1–D7). The agreed README draft became `README.md`.

This file lives at `docs/plans/temple-bar.md` (P6.5). It is the record: decisions, phase definitions, and each phase's status when it starts and ends. Planned work, progress and incidents are GitHub issues; the gitignored `.temple-bar/` folder holds local drafts only (decision 37).

---

## 1. Decisions (approved list — briefs and phases are checked against this, P6.1)

One line per decision. The full rule as it holds today, and the reasons behind it, live in the linked [ADR](../adr/).

Settled before this session:

- Repo, packages and MIT licence: [ADR 0002](../adr/0002-what-temple-bar-is-for.md)
- TypeScript on Node, Node built-ins only, bash only as hook shims: [ADR 0006](../adr/0006-building-and-releasing-temple-bar.md)
- Published to the npm registry only (no JSR): [ADR 0006](../adr/0006-building-and-releasing-temple-bar.md)
- Models: phases rated routine / involved / delicate; the maintainer picks models, temple-bar never does: [ADR 0002](../adr/0002-what-temple-bar-is-for.md)
- What became of the earlier hardening plan's D2, D3, D4 and D7: [ADR 0002](../adr/0002-what-temple-bar-is-for.md)

Decided 2026-09-28 (1–16), in the post-phase-1 review from 2026-09-29 (17–36), 2026-10-01 with the move to GitHub issues (37–40), while building 0.0.5 on 2026-10-01 and 2 (41–45), after the judge's trial on 2026-10-03 (46–54), and while planning 0.0.8 on 2026-10-04 (55). Decisions 5, 23 and 28 were revised on 2026-10-03, after setup was first tried on framework scaffolds, and 28 again on 2026-10-04, when 0.0.10 was added:

| #   | Decision                                                                            | ADR                                                       |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | The README opens with a plain two-sentence intro, then setup, then the background   | [0009](../adr/0009-readme-and-agents-md.md)               |
| 2   | Public but highly opinionated: the maintainer's defaults, 0.x versions              | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 3   | GitHub only: a git repo, `gh` signed in, `origin` on GitHub                         | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 4   | `main` changes only through merged pull requests; hooks guard local `main`          | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 5   | Scaffold first, then setup through `pnpm create` layers on top; pnpm only           | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 6   | Stage0: plain checks, 3-OS CI and GitHub protection before the first release        | [0006](../adr/0006-building-and-releasing-temple-bar.md)  |
| 7   | temple-bar's repo is gated by its last published release, never its source          | [0006](../adr/0006-building-and-releasing-temple-bar.md)  |
| 8   | Only CI publishes, through npm trusted publishing with provenance                   | [0006](../adr/0006-building-and-releasing-temple-bar.md)  |
| 9   | pnpm workspaces, Node 24+, CI on 3 OSes; strict ESLint and Prettier                 | [0006](../adr/0006-building-and-releasing-temple-bar.md)  |
| 10  | Base-check tools: gitleaks by verified download, npm tools pinned, local links      | [0007](../adr/0007-what-the-gate-checks.md)               |
| 11  | No timebox: the first real release is defined by scope                              | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 12  | No TypeScript logo, a capital S, and no disclaimer in temple-bar itself             | [0009](../adr/0009-readme-and-agents-md.md)               |
| 13  | No `doctor` command: hooks and the gate keep status truthful                        | [0008](../adr/0008-status-without-doctor.md)              |
| 14  | Status is a published, versioned contract with a live log per worktree              | [0008](../adr/0008-status-without-doctor.md)              |
| 15  | Each project declares delivery paths with end-to-end checks the gate runs           | [0007](../adr/0007-what-the-gate-checks.md)               |
| 16  | Worktrees go where the harness puts them; temple-bar checks the harms               | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 17  | Squash merges only; one pull request per phase; linear, signed history on `main`    | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 18  | The orchestrator merges when green, except changes that need the maintainer's yes   | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 19  | Agents keep the README accurate; a rewrite or new structure is the maintainer's     | [0009](../adr/0009-readme-and-agents-md.md)               |
| 20  | `--help` runs nothing; a passing gate lists the checks that ran                     | [0007](../adr/0007-what-the-gate-checks.md)               |
| 21  | The README says hooks arrive with the install; nothing more for fresh clones        | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 22  | Hooks fail closed where temple-bar isn't installed yet                              | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 23  | The gate requires the four scripts once a repo has content, never as no-ops         | [0007](../adr/0007-what-the-gate-checks.md)               |
| 24  | Conventional, proportional commit messages, also for pull request titles            | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 25  | CodeQL is a required check on the `main` ruleset                                    | [0004](../adr/0004-github-settings-temple-bar-applies.md) |
| 26  | The test suite runs shut off from the machine's git config                          | [0006](../adr/0006-building-and-releasing-temple-bar.md)  |
| 27  | _Superseded by 37._ A gitignored `planning/` folder held progress and the handoff   | [0010](../adr/0010-plans-progress-and-incidents.md)       |
| 28  | grand-union starts once temple-bar 0.0.10 ships; other themes continue alongside    | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 29  | Working, standards-following code first; a showcase for TypeScript devs second      | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 30  | Worktree location stays each harness's choice; one inside the repo is made safe     | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 31  | Built for every London TypeScript repo; GitHub, `gh` and pnpm required              | [0002](../adr/0002-what-temple-bar-is-for.md)             |
| 32  | A `post-checkout` hook sets up every new worktree                                   | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 33  | `temple-bar merge` does the whole merge, cleanup included                           | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 34  | The same GitHub rulesets on every London TypeScript repo, signed commits included   | [0004](../adr/0004-github-settings-temple-bar-applies.md) |
| 35  | Push once, when the work is finished                                                | [0003](../adr/0003-how-a-change-reaches-main.md)          |
| 36  | AGENTS.md stays within 200 lines and 32 KiB                                         | [0009](../adr/0009-readme-and-agents-md.md)               |
| 37  | GitHub issues are the tracker (supersedes 27)                                       | [0010](../adr/0010-plans-progress-and-incidents.md)       |
| 38  | Incidents improve temple-bar only, filed as its issues with no private details      | [0010](../adr/0010-plans-progress-and-incidents.md)       |
| 39  | No project board until grand-union, which then gets its own                         | [0010](../adr/0010-plans-progress-and-incidents.md)       |
| 40  | temple-bar applies a short fixed list of GitHub settings, not all of them           | [0004](../adr/0004-github-settings-temple-bar-applies.md) |
| 41  | A judge run from `main` refuses changes to workflows, the pin or gate scripts       | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 42  | The maintainer bypass-merges check changes; `temple-bar merge` never bypasses       | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 43  | The gate's ruleset check supports public repos only for now                         | [0004](../adr/0004-github-settings-temple-bar-applies.md) |
| 44  | A repo without AGENTS.md skips the size check rather than failing                   | [0007](../adr/0007-what-the-gate-checks.md)               |
| 45  | Hooks live in git's shared hooks folder, so every worktree has them                 | [0005](../adr/0005-setup-hooks-and-worktrees.md)          |
| 46  | Repository admins merge check changes past the judge, through a pull request only   | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 47  | `merge` refuses check changes; it and the judge both say to ask for the admin merge | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 48  | `ready` warns about exactly the files the judge guards, from the judge's own list   | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 49  | Bypass merges are detected and reported from rule-suite history (from 0.0.8)        | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 50  | The gate fails without the judge's ruleset, except while its workflow is on its way | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 51  | One maintainer yes creates both rulesets                                            | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 52  | The judge runs the pinned temple-bar with `npm exec`                                | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 53  | temple-bar's own judge is switched on in the 0.0.7 release, before the pin bump     | [0011](../adr/0011-which-checks-judge-a-pull-request.md)  |
| 54  | Merge refuses 2+ closed issues without a `One concern:` line                        | [rationale](../agents-rationale.md)                       |
| 55  | Work is planned by milestone across the org; agents phase a milestone's issues      | [rationale](../agents-rationale.md)                       |

---

## 2. Your steps (things only you can do)

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | When       | Blocks |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| U1  | ~~Add the trademark disclaimer to the org's profile page (decision 12)~~ **Out of scope** 2026-09-30: org work, not temple-bar's                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Any time   | —      |
| U2  | ~~Create the public repo with a README and MIT licence~~ **Done** 2026-09-28 (created by Claude with your go-ahead)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —          | —      |
| U3  | ~~Org security configuration~~ **Done** 2026-09-28: the org's enforced security configuration is the default for new public repos. On temple-bar: secret scanning, push protection, Dependabot alerts and security updates, and code scanning default setup are all on. The brief's `*_for_new_repositories` check is out of date; the configuration default is what applies. GitHub Free has no Advanced Security on private repos, so a separate free-features configuration (dependency graph, Dependabot) covers those. Private vulnerability reporting is on for temple-bar. | —          | —      |
| U4  | ~~Ruleset on `main`~~ **Done**: ruleset 24133476 "main: pull requests only" (PR required with 0 approvals, since you can't approve your own PR; no force-push; no deletion; no bypass). Required status checks come in U6.                                                                                                                                                                                                                                                                                                                                                        | —          | —      |
| U5  | ~~Install `pnpm` and `gh`, run `gh auth login`~~ **Done**: checked 2026-09-28, pnpm 10.34.5 (the version G13's subagent installed globally) and gh 2.101.0 signed in over SSH                                                                                                                                                                                                                                                                                                                                                                                                     | —          | —      |
| U6  | ~~Add the CI jobs to the ruleset as required checks~~ **Done** 2026-09-28: the six `check (<os>, node <n>)` jobs are required on the `main` ruleset (not strict; also enforced on creation).                                                                                                                                                                                                                                                                                                                                                                                      | —          | —      |
| U7  | ~~Publish `0.0.1` of both packages by hand~~ **Done** 2026-09-29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | After 1.9  | 1.10   |
| U8  | ~~Add a trusted publisher to each package on npmjs.com~~ **Done** 2026-09-29, set to staged publishing on purpose, so every release waits for your 2FA approval                                                                                                                                                                                                                                                                                                                                                                                                                   | After U7   | 1.10   |
| U9  | Approve and merge each pull request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Throughout | —      |
| U10 | **Moved** 2026-10-01: your open steps are [issues assigned to you](https://github.com/londontypescript/temple-bar/issues?q=is%3Aissue%20is%3Aopen%20assignee%3Annseenain)                                                                                                                                                                                                                                                                                                                                                                                                         | —          | —      |

---

## 3. Layer 1 — Phase 1: stage0

**Goal:** a public repo with CI on three operating systems, a minimal temple-bar published to npm with provenance, and temple-bar's own repo protected by that published version.

**The honest gap during this phase:** the local hooks don't exist yet. Until 1.10, temple-bar's own repo is protected by GitHub (PR-only `main`, required CI) and by prose rules only. Locally, nothing stops an agent committing to `main` or editing a delegated file. So:

- The orchestrator keeps parallel work to **clearly separate packages or folders** and doesn't touch delegated files.
- Every change goes through a pull request.
- Anything that goes wrong is written into §6 of this file as a proposed incident. There's no incident tool yet.

**Tracking:** this file's checkboxes, ticked at every subtask. v1's `status.sh` doesn't exist in the new repo, so this file _is_ the status until theme E lands.

### Subtasks

Ratings: **R** routine · **I** involved · **D** delicate. "∥" marks work that can run in parallel.

#### 1.1 Rules first — **D**, orchestrator, sequential

- [x] A pull request with only docs: `AGENTS.md` for temple-bar's own repo, the README from the draft (marked pre-release), this plan moved to `docs/plans/temple-bar.md`, `.gitignore` (ignores env files, keeps `*.example`) and `.editorconfig`. Also `CLAUDE.md`, which only imports `AGENTS.md`, because Claude Code doesn't load `AGENTS.md` by itself (added during 1.1, P1.5).
- [x] `AGENTS.md` carries v1's rules adjusted for today's decisions, plus these lines specific to this repo:
  - "This repo is gated by the last published temple-bar. Its own source never runs as its tooling, and no feature exists to make it do so."
  - "Until 1.10, the local rules are prose only. Every change goes through a pull request."
- [x] **Redaction pass before committing** (P7.2): the repo is public. The plan may name the user's projects and cite incident IDs with one-line summaries, but carries no project-private details. The raw incident reports and the brief stay in the user's local v1 repo and are only read, never copied in.
- **Done when:** merged to `main` via a PR before any code exists (P1.2, G2). **Done** 2026-09-28, [#1](https://github.com/londontypescript/temple-bar/pull/1). The user can then delete the local planning folder in the v1 repo, which held the only copy until this point.

#### 1.2 Toolchain skeleton — **R**, sequential (everything depends on it)

- [x] pnpm workspace: `packages/temple-bar`, `packages/create-temple-bar`. `packageManager` pinned. `engines.node` set to `>=24`.
- [x] TypeScript strict, with the settings type stripping needs (`erasableSyntaxOnly`). A `tsc` build to `dist/`; `bin` points at the built JavaScript.
- [x] ESLint flat config (typescript-eslint strict type-checked) and Prettier.
- [x] Tests with `node:test`. `pnpm check` runs typecheck, lint, format check and tests.
- [x] The file-length cap, defined in one config place only, and checked.
- [x] **Verify P9.1a first:** confirm on Node 24 and 26 that type stripping refuses files under `node_modules`, so the published package must ship built JavaScript. Write the result down.
- **Done when:** `pnpm check` passes on a clean clone, and the P9.1a finding is recorded. **Done** 2026-09-28, [#2](https://github.com/londontypescript/temple-bar/pull/2).
- **P9.1a finding (2026-09-28):** confirmed on Node 24.21.0. Running a `.ts` file under `node_modules` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and the same file elsewhere runs. So the packages ship `tsc` output from `dist/`. The check is a test (`packages/temple-bar/src/type-stripping.test.ts`), so CI proves it on Node 26 as well.
- **Toolchain note:** TypeScript is pinned to 6.0.3, not 7. typescript-eslint 8.71 supports only `<6.1.0`, and type-aware linting stays on. Re-pin when typescript-eslint supports TypeScript 7. `@types/node` tracks the minimum Node (24).

#### 1.3 CI ∥ — **R**

- [x] `ci.yml`: a matrix of {ubuntu, macos, windows} × {Node 24, 26}, pnpm installed at the pinned version, running `pnpm check`. Stable job names, so they can become required checks (U6).
- **Done when:** all six jobs are green on a PR. Break-it evidence: a deliberately failing test turns the PR red. **Done** 2026-09-28, [#3](https://github.com/londontypescript/temple-bar/pull/3). Red: [run 36471435761](https://github.com/londontypescript/temple-bar/actions/runs/36471435761) (all six jobs failed on the deliberate test only, 1 of 7 tests). Green after the revert: [run 36471797611](https://github.com/londontypescript/temple-bar/actions/runs/36471797611). P9.1a's test passed on Node 26 in CI.

#### 1.4 CLI core — **I**, sequential after 1.2

- [x] The `temple-bar` command routes to subcommands. An unknown subcommand prints usage, exits non-zero and writes nothing (X12 / P8.2 regression test).
- [x] Seams (separate modules the rest of the code calls through) for git, `gh`, the filesystem, the clock and user prompts, so tests can fake them.
- **Done when:** tests cover the router, including the X12 case.

#### 1.5 Hooks — **D**, ∥ with 1.6 and 1.7 (separate folders)

- [x] `pre-commit`: refuses commits while `main` is checked out.
- [x] `reference-transaction`: local `main` may only move to a commit already on `origin/main`. The shell shim only starts Node when `main` is in the update, so it stays fast on fetches.
- [x] `init` sets `pull.ff=only`. (1.5 ships `hook install`, which sets it; `init` calls it in 1.7.)
- [x] Integration tests against real git repos in temp folders:
  - a direct commit to `main` is refused (N1)
  - a local squash, merge, cherry-pick or reset onto `main` is refused
  - `git pull --ff-only` after a merge on GitHub is allowed
  - `git commit --no-verify` on `main` is still refused by `reference-transaction`, which **must be verified** (the claim is that `--no-verify` doesn't skip that hook)
  - it all works on Windows
- **Done when:** all of those pass on 3 OSes, each with break-it evidence (disable the check, show the test fail, restore it).

#### 1.6 Gate v0 — **I**, ∥

- [x] `temple-bar gate` (#5):
  - runs the project's `typecheck`, `lint` and `test` scripts from `package.json`
  - exits 2 when code exists but those scripts are missing (D2, first part)
  - runs with `CI=true` (P3.3)
  - checks the file-length cap
  - always runs the full suite
- [x] A held lock, or the presence of worktrees, never fails it (P3.7). Only the test for this lands now; locks arrive later. (#5: the nested-worktree test)
- **Done when:** tested against sample projects: one passing, one failing, and one with code but no scripts.

#### 1.7 Setup (`init`) and launcher — **I**, ∥

- [x] `init`:
  - checks for a git repo, `gh` installed and signed in, and `origin` on GitHub, stopping with the exact fix if one is missing
  - offers `gh repo create` and the `main` ruleset only on an explicit yes; with no terminal it prints the steps and exits non-zero
  - writes a _minimal_ `AGENTS.md` only if none exists (the full rules come in theme A)
  - installs the hook shims and sets `core.hooksPath`
  - adds `prepare` and `gate` scripts
  - never deletes anything, and a second run changes nothing (N6, N9)
- [x] `create-temple-bar`: detects the package manager, creates `package.json` if needed, adds `@londontypescript/temple-bar` as a dev dependency, and runs `temple-bar init`.
- **Done when:** tests cover a new empty repo, an existing project, a second run, and each missing requirement.

#### 1.8 Pack-and-install test — **I**, after 1.5–1.7

- [x] Pack both packages. In a temp git repo, install them from the tarballs **with npm and with pnpm**. Run the setup, then show that a commit to `main` is refused and the gate runs.
- [x] Faking GitHub in the test: put a fake `gh` first on `PATH`, and use git's `url.<local>.insteadOf` so a `github.com` origin points at a local bare repo. **Changed in 1.8:** the fake `gh` is a copy of the Node binary named `gh` plus a preload script (the gh seam can't start a script shim on Windows). `insteadOf` was dropped: `git remote get-url` returns the rewritten URL, so `init` would see a non-GitHub origin, and the test never needs to push. The launcher gets temple-bar from a local registry on `node:http` serving the packed tarball.
- **Done when:** green on all six CI jobs. This is the test that proves the published package works from `node_modules` (P9.1a, the G5 class of bug).

#### 1.9 Release workflow ∥ — **I**

- [x] `release.yml`, run by hand (`workflow_dispatch`) or on a version tag: build, `pnpm check`, then publish both packages in lockstep on the `next` tag, with `id-token: write`, npm ≥11.5.1 and provenance.
- **Done when:** the workflow is reviewed and merged. It can't run for real until U7 and U8 are done. **Done** 2026-09-28, [#3](https://github.com/londontypescript/temple-bar/pull/3). It publishes with `npm publish` (pinned npm), because `pnpm publish` doesn't support trusted publishing yet (pnpm/pnpm#9812).

#### 1.10 Stage0 release and self-protection — **D**, orchestrator with you

- [x] Tag `v0.0.1`. **You:** U7 (manual publish), then U8 (trusted publishers). **Done** 2026-09-29, [#11](https://github.com/londontypescript/temple-bar/pull/11).
- [x] Bump to `0.0.2` in a PR. After you approve it, run `release.yml`. **Check:** both packages show provenance on npm. **Done** 2026-09-29, [#12](https://github.com/londontypescript/temple-bar/pull/12). The first run got a 403 because the trusted publishers allow staged publishing only; [#15](https://github.com/londontypescript/temple-bar/pull/15) switched `release.yml` to `npm stage publish`, and you approved both staged packages on npmjs.com. Both have provenance; `latest` and `next` point to 0.0.2.
- [x] A PR that pins `@londontypescript/temple-bar@0.0.2` as a dev dependency of the repo and runs its `init`. **Done** 2026-09-29, [#16](https://github.com/londontypescript/temple-bar/pull/16), resolved from the registry, not the workspace.
- [x] **Break-it evidence in the real repo:** a commit to local `main` is refused; the gate runs. **Done** 2026-09-29, approved by you: a plain commit, a `--no-verify` commit, moving `main` to a commit not on `origin/main` and deleting `main` were all refused, `main` did not move, and `pnpm gate` exited 0.
- **Done when:** all of the above, and you approve.

### Phase 1 exit criteria

- The repo is public, with the security configuration and the `main` ruleset (required PR plus six required CI jobs).
- `0.0.2` of both packages is on npm, published from CI with provenance, on the `next` tag.
- temple-bar's own repo is protected by the pinned `0.0.2`, shown by the break-it evidence.
- The pack-and-install test is green under npm and pnpm on all three operating systems.

### Staffing and size

- **Models (your rule):** Opus is the orchestrator. It writes 1.1, reviews every PR line by line (P5.4), and runs 1.10 with you. Sonnet subagents implement everything else: 1.2, 1.4, then 1.3+1.9 (one agent, same folder), 1.5, 1.6 and 1.7 in parallel, then 1.8.
- **Parallelism:** as far as the order below allows (up to 5 at once in the middle wave). You judged Sonnet cheap enough that this isn't a usage concern. The cost to watch is Opus review time, and parallel work bunches the reviews together.
- **Rough size:** about 800–1,000 lines of source, about 900 lines of tests, and about 750 lines of docs, config and CI. The difficulty is behaviour across 3 OSes, not volume.
- **Natural pauses** to check usage: U6 (after 1.3) and U7/U8 (after 1.9). If a usage window ends mid-phase, resume from git and this file's checkboxes (AGENTS.md §7).

### Parallelism and scope ownership

- **Order:** 1.1 → 1.2 → 1.4. Then 1.3, 1.5, 1.6, 1.7 and 1.9 can run in parallel. Then 1.8, then 1.10.
- **Who owns which files:**
  - 1.3 and 1.9 own `.github/workflows/`
  - 1.5 owns `packages/temple-bar/src/hooks/`
  - 1.6 owns `src/gate/`
  - 1.7 owns `src/init/` and `packages/create-temple-bar/`
  - Root config files (`package.json`, the lockfile, tsconfig, ESLint config) belong to the orchestrator. A subtask that needs a change there reports it rather than making it (P5.1, X4).
- **Honest note:** there's no lock enforcement yet. The orchestrator should only run in parallel what it's comfortable reviewing file by file.

---

## 3a. Mini plan: 0.0.3 and the easy review decisions

Approved 2026-09-29; **done 2026-09-29**, approved by you: #18, #20–#24 and the `v0.0.3` release. Added along the way: `--help` for the `npm create` launcher (#22). Implements decisions 17–27. Ratings as in §3; models, your choice: **I** Opus 5.5, **R** Sonnet 5.5, orchestrator Opus.

- **M1 Plan pull request** (D, orchestrator): decisions 17–27 in §1, this section, the AGENTS.md changes (§0, §1, §2, §4, §7, §8, §9) and the §6 proposals from the review. The handoff moves to `planning/`. **You:** yes to merge (it changes AGENTS.md).
- **M2 GitHub settings** (R, orchestrator, after M1): ruleset allows only squash and rebase, requires linear history, and requires CodeQL. **Break-it:** a merge-commit attempt is refused.
- **M3a Gate changes** (I, subagent, ∥ M2 and M3b): `--help` and `-h` on every command; `format:check` required; a pass lists the checks. Package READMEs made factually accurate; you see the diff first. Scope: `packages/*/src/**` except `src/testing/`, and `packages/*/README.md`.
- **M3b Test isolation** (R, subagent, ∥): scope `src/testing/`, `e2e/support/`, a setup file under `scripts/`; the root `package.json` change is the orchestrator's. **Break-it:** a global config with signing on fails a test without the isolation and passes with it.
- **M4 Release 0.0.3** (D, orchestrator with you, after M3a and M3b): bump PR; tag after your yes; the workflow stages both packages. **You:** approve on npmjs.com with 2FA, then move `latest`. **Check:** provenance.
- **M5 Pin 0.0.3** (D, orchestrator, after M4): pin in its own PR; CI runs `pnpm gate` and `pnpm build`; `pnpm check` becomes an alias for the gate; the repo's own length-check script goes. **Break-it:** a misformatted file fails CI through the pinned gate. **You:** yes to merge (it bumps the pin).
- **Done when:** M5 is merged with its break-it evidence, and you approve.
- **Not in it:** your README rewrite; open review items (worktree location, cross-provider PR review, the remaining 1.5 and 1.7 findings, the refused fast-forward after setup, worktree setup scripts, copying env vars into worktrees, incident curation, what temple-bar dictates about planning).

---

## 3b. Migration plan: planning moves to GitHub issues

Approved 2026-10-01; **done 2026-10-01**: [#111](https://github.com/londontypescript/temple-bar/pull/111) merged and #34 closed. Tracked in [#34](https://github.com/londontypescript/temple-bar/issues/34) and its sub-issues. Implements decisions 37–40. Ratings as in §3; models, your choice.

- **Issues hold** planned work (themes A–F, the final pass), open questions, open review items, your remaining steps, kept incidents and all progress. **Git keeps** the decisions (§1), phase history (§3, §3a), ADRs and AGENTS.md. **Gone:** `planning/handoff.md` and the old progress wall plan; `planning/` stays, gitignored, for local drafts only.
- **Organisation:** the org's issue types (Task, Feature, Bug); one label per theme (`setup` A, `gate` B, `main` C, `subagents` D, `status` E, `incident-loop` F, `showcase` final pass), plus `needs-decision` and `incident`; only the `0.0.4` milestone. You are assigned your own steps and every `needs-decision` issue; agents assign themselves when they pick work up.
- **M0 Track the migration on GitHub** (R, orchestrator): the labels, and #34 with a sub-issue per phase.
- **M1 Draft every issue locally** (I, two subagents, after M0): from §2, §4, the kept incidents, the open review items and the 1 October findings, checked against §1 and for private details. **You:** read the draft; nothing is public until you say yes.
- **M2 Create the issues** (R, orchestrator, after your yes to M1). **Check:** the count and labels on GitHub match the draft.
- **M3 Draft the repo changes** (D, subagent, ∥ M1): this section, decisions 37–40, §2, §4 and §6 as pointers, AGENTS.md §1, §7 and §8 within the 200-line cap, and `docs/enforcement.md`. **You:** agree the draft before it's pushed.
- **M4 One pull request** (D, orchestrator, after M2 and your yes to M3): pushed once, CI and CodeQL watched. **You:** yes to merge (it changes AGENTS.md).
- **M5 Clean up** (R, orchestrator, after M4 merges): delete `planning/handoff.md`, retire the old wall plan, close #34.
- **Done when:** every item from §2, §4 and the kept incidents is an issue the plan points at; AGENTS.md describes issues as the tracker within 200 lines; the handoff file is gone and #34 is closed.
- **Not in it:** creating `londontypescript/.github` (organisation work), a project board (decision 39), any code change. Next, straight after: the ADR phase, where the decisions become topic ADRs.

---

## 4. Layer 2 — later phases

Each theme's items and its open questions are GitHub issues under the theme's label. The themes are grouped by the problem they solve, **not ordered**: the order is yours.

- **Theme A — Set up fully; the core can't be trimmed.** Setup installs the whole core, and the gate checks it is still there: [`setup`](https://github.com/londontypescript/temple-bar/issues?q=label%3Asetup)
- **Theme B — A gate that can't be quietly weakened.** Every base check runs, and no check shrinks without an ADR: [`gate`](https://github.com/londontypescript/temple-bar/issues?q=label%3Agate)
- **Theme C — `main`, remaining pieces.** Commit messages, the merge and push-once enforced by temple-bar, not prose: [`main`](https://github.com/londontypescript/temple-bar/issues?q=label%3Amain)
- **Theme D — Subagents boxed in.** Subagents work in scoped, set-up worktrees and can't merge or overlap: [`subagents`](https://github.com/londontypescript/temple-bar/issues?q=label%3Asubagents)
- **Theme E — Status you can trust.** A published status contract and live log that stay truthful for every worktree: [`status`](https://github.com/londontypescript/temple-bar/issues?q=label%3Astatus)
- **Theme F — The incident loop.** Agents propose incidents, you curate them, and fixes flow back into temple-bar: [`incident-loop`](https://github.com/londontypescript/temple-bar/issues?q=label%3Aincident-loop)
- **Final pass — showcase quality** (after every theme; decision 29). Settled code made fit for TypeScript developers of every level to read: [`showcase`](https://github.com/londontypescript/temple-bar/issues?q=label%3Ashowcase)
- **Open questions:** [`needs-decision`](https://github.com/londontypescript/temple-bar/issues?q=label%3Aneeds-decision), each assigned to you.

---

## 5. Coverage of the brief

Where every brief item lives. The brief requires each one to be built, deferred or rejected by you.

| Item                                    | Where                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1.1 core not trimmable                 | Theme A (gate only; decision 13)                                                                 |
| P1.2 rules before code                  | Phase 1 (1.1) for this repo; theme A for projects                                                |
| P1.3 upgrades carry fixes               | Theme A + theme F                                                                                |
| P1.4 init non-destructive               | Phase 1 (1.7), extended in theme A                                                               |
| P1.5 instructions where the agent reads | README draft (decision 5)                                                                        |
| P1.6 mid-setup gate passes              | Theme A                                                                                          |
| P1.7 pnpm, hooks from a fresh clone     | Phase 1 (1.7, 1.8)                                                                               |
| P2.1–P2.3 main history                  | Replaced by decision 4 (phase 1); leftovers in theme C                                           |
| P2.4 every merge is the orchestrator's  | Theme D                                                                                          |
| P2.5 merge approval                     | Theme C + rules                                                                                  |
| P3.1 base checks, D2                    | Phase 1 (gate v0) + theme B                                                                      |
| P3.2 no weakening                       | Theme B                                                                                          |
| P3.3 `CI=true`                          | Phase 1 (1.6)                                                                                    |
| P3.4 branch from a gated commit         | Theme D (decision 16)                                                                            |
| P3.5 claims cite checks                 | Theme B                                                                                          |
| P3.6 knip                               | Theme B                                                                                          |
| P3.7 machinery never fails the gate     | Phase 1 test + themes B, D                                                                       |
| P4.1 target matrix                      | Theme B (decision 15)                                                                            |
| P4.2–P4.7 verification                  | Theme A (rules) + theme B                                                                        |
| P5.1–P5.5 delegation rules              | Theme A (rules) + theme D (report format)                                                        |
| P5.6 harness hooks                      | Theme D, waiting on Q8                                                                           |
| P5.7 worktrees                          | Replaced by decision 16 → theme D                                                                |
| P5.8 overlapping locks                  | Theme D                                                                                          |
| P6.1 decisions list                     | This file, §1 + rules                                                                            |
| P6.2 ratings, not models                | This file + rules                                                                                |
| P6.3 proportionality                    | Rules (prose)                                                                                    |
| P6.4 partial status, phone width        | Theme E                                                                                          |
| P6.5 plans in the repo                  | Phase 1 (1.1)                                                                                    |
| P6.6 status for a morning brief         | Replaced by decisions 13 and 14 → theme E                                                        |
| P7.1 SECURITY.md review                 | Rules (prose, named step)                                                                        |
| P7.2 public hygiene, redaction          | Phase 1 (U3) + theme F (Q7)                                                                      |
| P7.3 trusted publishing                 | Phase 1 (decision 8)                                                                             |
| P8.1–P8.5 incident loop                 | Theme F (P8.2's test is in phase 1)                                                              |
| P9.1, P9.1a                             | Phase 1 (1.2, 1.8)                                                                               |
| P9.1b npm only                          | Decided                                                                                          |
| P9.2 3-OS CI                            | Phase 1 (1.3)                                                                                    |
| P9.3 fresh cloud session                | Nice-to-have; checked in theme A                                                                 |
| §4 regressions                          | Phase 1: N1, X12. Theme A: N6, N7, N9, N10. Theme B: X5. Theme D: X1, N2, N15. Theme E: N11, N14 |

---

## 6. Incidents

Incidents are [GitHub issues labelled `incident`](https://github.com/londontypescript/temple-bar/issues?q=label%3Aincident), proposed and filed as AGENTS.md §8 describes (decision 38). The 13 proposals listed here during phase 1 were curated on 2026-10-01: 4, 5 and 8 kept as issues, the rest dropped. Their text stays in the history of this file.
