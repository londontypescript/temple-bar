# Plan: temple-bar

Status: **Layer 1 (phase 1) DONE 2026-09-29. The 0.0.3 mini plan (§3a) DONE 2026-09-29: 0.0.3 is on npm as `latest`, and CI here runs the published 0.0.3 gate.** Next: the release-workflow PR (full CI before staging, `latest` on approval, draft GitHub Releases), then the rest of the post-phase-1 review, then Layer 2.

Approval is in two layers, as agreed:

1. **Layer 1: Phase 1 (stage0)** is fully detailed below. Approving it lets the build start.
2. **Layer 2: later phases** are outlined only, each marked with what it's waiting on. Each one gets detailed and approved before it starts.

Inputs, kept outside this public repo in the user's local v1 repo (`nnsee-agentic`) and only read, never copied in: the brief (P1–P9, §4), the incident intake beside it (IDs F = futura-maximila, G = grand-union, N = nnsee-agentic), and the frozen hardening plan (D1–D7). The agreed README draft became `README.md`.

This file lives at `docs/plans/temple-bar.md` (P6.5). It is the record: decisions, phase definitions, incidents, and each phase's status when it starts and ends (decision 27). Per-subtask progress and the handoff live in the gitignored `planning/` folder.

---

## 1. Decisions (approved list — briefs and phases are checked against this, P6.1)

Settled before this session:

- Repo `londontypescript/temple-bar`, public from day one; packages `@londontypescript/temple-bar` and (new today) `@londontypescript/create-temple-bar`; command `temple-bar`. MIT licence.
- TypeScript on Node, Node built-ins only for the machinery; bash only as one-line hook shims; no Python.
- Shipped as an npm package; npm only for now (P9.1b, no JSR).
- Models: Opus orchestrates, plans and verifies; Sonnet implements. temple-bar itself never picks a model (D7); phases are rated routine / involved / delicate.
- D1–D7 fates as in the brief's table. D2, D3, D4 and D7 carry over, adjusted below where today's decisions change them.

Decided 2026-09-28:

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Slogan: "Prose != Enforcement".** The README opens with it, explains the deterministic workflow around a non-deterministic agent, the blocked / detected / prompted / prose-only labels, London TypeScript, and the name story. The incident loop appears as an "in progress" placeholder.                                                                                                                                                                                                                                                                                                                                     |
| 2   | **Public but highly opinionated.** Your defaults, no promise of configurability, 0.x versions. The README says so up front.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | **GitHub-only.** Setup requires a git repo, `gh` installed and signed in, and `origin` on GitHub. There's no "local merges" mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | **`main` changes only through merged pull requests** (GitHub flow). You merge (web, mobile, or say yes and the agent runs `gh pr merge`). A `reference-transaction` hook lets local `main` move only to commits already on `origin/main`. Phase → feature squashes stay local. Agents push branches and open PRs, never `main`.                                                                                                                                                                                                                                                                                                  |
| 5   | **Setup:** the docs lead with a copy-paste prompt for the user's agent, linking to the README's `#for-ai-agents` section. The command is `npm create @londontypescript/temple-bar@latest` (all package managers), which runs the thin launcher `create-temple-bar`. temple-bar comes first, and scaffolding is phase 1 of the project's own plan; existing projects are supported. `init` asks before any GitHub change, writes a `prepare` script, and never deletes. No install scripts. The rules it installs make "ask the user what they're building" the first step for a new project.                                     |
| 6   | **Bootstrap (stage0):** plain checks, 3-OS CI and GitHub protection from the first commit. Phase 1 builds a minimal core and publishes it; the repo then pins it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | **Self-use:** temple-bar's repo is gated by its own **last published release** (like TypeScript's "last known good"), never its own source. Pin bumps are deliberate, reviewed changes. No self-referential features.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **Publishing:** only CI publishes, via npm trusted publishing with provenance (P7.3, confirmed). One exception: you publish `0.0.1` of each package by hand (clean tagged checkout, 2FA), because trusted publishing only works for packages that already exist. `0.0.2` then comes from CI.                                                                                                                                                                                                                                                                                                                                     |
| 9   | **Toolchain:** pnpm workspaces, which is also the convention for every londontypescript repo; Node ≥24 with CI on 24 and 26 × Ubuntu, macOS and Windows (Windows required); ESLint (typescript-eslint strict type-checked) + Prettier.                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | **Base-check tools:** gitleaks via verified download (pinned version and SHA-256 per OS, cached); npm tools (markdownlint-cli2, knip) are package dependencies pinned by the lockfile; a built-in link check covering local links and cited paths only.                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | **No timebox.** The first real release is defined by scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | **Trademark:** the disclaimer belongs to the "London TypeScript" name, so it goes on the **org profile** (and the meetup site), in Microsoft's form: "TypeScript is a trademark of the Microsoft group of companies", plus "not affiliated with or endorsed by Microsoft". temple-bar's README and package carry none, because its name doesn't use the mark. temple-bar never uses the TypeScript logo, and writes "TypeScript" with a capital S. Guidelines read 2026-09-28: Microsoft's general guidelines discourage marks in community names, while TypeScript's branding page only restricts product use. Judged low risk. |
| 13  | **No `doctor` command.** Status stays truthful through hooks and the gate. Cross-project views stay in your own tools, which temple-bar never mentions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 14  | **Status:** a published contract (versioned schema, exported types, additive-only changes). A live JSONL log per worktree (status plus git events), cleared when the branch ends. One rule: _when a branch's work ends, everything local about it goes._                                                                                                                                                                                                                                                                                                                                                                         |
| 15  | **Target matrix:** each project declares its delivery paths, each with an end-to-end check. The gate runs them all, won't accept the unit-test command as a target check, and requires at least one target once code exists. grand-union v2 is the first user; temple-bar doesn't use it on itself.                                                                                                                                                                                                                                                                                                                              |
| 16  | **Worktrees:** the harness decides where they go, and `git worktree list` is the truth. temple-bar checks the harms instead: dependencies installed and in sync, `.env` keys present (env files copied in, keys never values), and an explanation when tools scan nested worktrees. P3.4 ("branch only from a gated commit") becomes a `reference-transaction` check keyed on what a branch is, not its name.                                                                                                                                                                                                                    |

Decided 2026-09-29, in the post-phase-1 review (the easy items; the rest are still open):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | **Merge method:** quick changes squash to one commit; a multi-phase feature rebases, one commit per phase. The `main` ruleset allows only squash and rebase and requires linear history. v1 had this rule, but only as the words "squash" and "fast-forward" inside local-merge arrows, so decision 4 removed it with the mechanism.                                                                                                                                                                                                                                         |
| 18  | **Who merges:** Claude merges a pull request once CI and CodeQL are green, except one that changes AGENTS.md, bumps the pinned temple-bar, tags or publishes; those need your yes.                                                                                                                                                                                                                                                                                                                                                                                           |
| 19  | **README:** you write the rewrite yourself, after the 0.0.3 mini plan. Agents supply facts and show any README change as a draft first.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 20  | **Gate polish:** `--help` on any command shows help and runs nothing; a passing gate lists the checks that ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 21  | **Fresh clones:** the README says hooks arrive with the install. Nothing more; the audience runs the install anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 22  | **Before install:** hooks keep failing closed where temple-bar isn't installed. The friction is handled by worktree setup scripts (still open).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 23  | **The gate owns the checks:** it requires `typecheck`, `lint`, `test` and `format:check`. CI runs the pinned `pnpm gate` as the merge condition; `pnpm build` stays a separate CI step; the repo's duplicate length script goes.                                                                                                                                                                                                                                                                                                                                             |
| 24  | **Commit messages:** conventional prefixes (`feat`, `fix`, `docs`, `chore`, with a scope), proportional to the change, naming the change and never the trigger. Applies to pull request titles and bodies too.                                                                                                                                                                                                                                                                                                                                                               |
| 25  | **CodeQL** is a required check on the `main` ruleset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 26  | **Test isolation:** the whole suite runs shut off from the machine's git config (`GIT_CONFIG_GLOBAL`, no system config).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 27  | **Record versus live tracker:** git holds decisions, phase definitions, incidents, and phase status at start and end. Subtask progress and the handoff live in gitignored `planning/`, readable by every agent. The handoff leaves Claude's private memory.                                                                                                                                                                                                                                                                                                                  |
| 28  | **Fully featured first:** temple-bar and grand-union are the foundation of the London TypeScript GitHub org. temple-bar gets every theme (A–F) before grand-union is built on it.                                                                                                                                                                                                                                                                                                                                                                                            |
| 29  | **A showcase for TypeScript developers of every level:** the code must impress, and every contested choice needs a written rationale (a decision here or an ADR). New code follows the comment convention in AGENTS.md §5 from now on. One full quality pass over settled code comes once every theme is built: plain-language comments in place of the existing plan IDs, repetition removed, a newcomer's map of the code, and the ADRs behind them.                                                                                                                       |
| 30  | **Worktree location stays the harness's choice; temple-bar checks the harms, for every harness.** Codex, Antigravity, Claude Code, Grok or a person each put worktrees where their own mechanism does (decision 16). temple-bar never sets or assumes a location. It detects the harms of a worktree nested inside the repo (not git-ignored, reached by ESLint or other tools, running on the main checkout's `node_modules`) through git alone, so the checks are the same whichever tool made it. Its docs recommend keeping worktrees outside the repo, and explain why. |

Brief items changed by these decisions (the rest stand as written):

- P1.1: "the gate _or doctor_" becomes the gate only.
- P2.1–P2.3: largely replaced by decision 4. The plan re-checks whether the pre-merge-commit guard and the bypass ledger still add anything.
- D3.2 "main's copy judges": still needed, but PR CI runs the PR's own workflow copy. Needs its own design (Layer 2, theme B).
- P5.7: replaced by decision 16.
- P6.6: replaced by decisions 13 and 14.

---

## 2. Your steps (things only you can do)

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | When       | Blocks  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| U1  | Add the trademark disclaimer to the org's profile page (decision 12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Any time   | —       |
| U2  | ~~Create the public repo with a README and MIT licence~~ **Done** 2026-09-28 (created by Claude with your go-ahead)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —          | —       |
| U3  | ~~Org security configuration~~ **Done** 2026-09-28: the org's enforced security configuration is the default for new public repos. On temple-bar: secret scanning, push protection, Dependabot alerts and security updates, and code scanning default setup are all on. The brief's `*_for_new_repositories` check is out of date; the configuration default is what applies. GitHub Free has no Advanced Security on private repos, so a separate free-features configuration (dependency graph, Dependabot) covers those. Private vulnerability reporting is on for temple-bar. | —          | —       |
| U4  | ~~Ruleset on `main`~~ **Done**: ruleset 24133476 "main: pull requests only" (PR required with 0 approvals, since you can't approve your own PR; no force-push; no deletion; no bypass). Required status checks come in U6.                                                                                                                                                                                                                                                                                                                                                        | —          | —       |
| U5  | ~~Install `pnpm` and `gh`, run `gh auth login`~~ **Done**: checked 2026-09-28, pnpm 10.34.5 (the version G13's subagent installed globally) and gh 2.101.0 signed in over SSH                                                                                                                                                                                                                                                                                                                                                                                                     | —          | —       |
| U6  | ~~Add the CI jobs to the ruleset as required checks~~ **Done** 2026-09-28: the six `check (<os>, node <n>)` jobs are required on the `main` ruleset (not strict; also enforced on creation).                                                                                                                                                                                                                                                                                                                                                                                      | —          | —       |
| U7  | ~~Publish `0.0.1` of both packages by hand~~ **Done** 2026-09-29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | After 1.9  | 1.10    |
| U8  | ~~Add a trusted publisher to each package on npmjs.com~~ **Done** 2026-09-29, set to staged publishing on purpose, so every release waits for your 2FA approval                                                                                                                                                                                                                                                                                                                                                                                                                   | After U7   | 1.10    |
| U9  | Approve and merge each pull request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Throughout | —       |
| U10 | Try Codex and Antigravity on this repo: where they put worktrees, whether the hooks and the gate still protect `main`, whether their worktrees can live outside the repo, and whether temple-bar's checks behave the same as with Claude Code (decision 30)                                                                                                                                                                                                                                                                                                                       | Any time   | theme D |

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

- [x] The `temple-bar` command routes to subcommands. An unknown subcommand prints usage, exits non-zero and writes nothing (F12 / P8.2 regression test).
- [x] Seams (separate modules the rest of the code calls through) for git, `gh`, the filesystem, the clock and user prompts, so tests can fake them.
- **Done when:** tests cover the router, including the F12 case.

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
  - Root config files (`package.json`, the lockfile, tsconfig, ESLint config) belong to the orchestrator. A subtask that needs a change there reports it rather than making it (P5.1, F4).
- **Honest note:** there's no lock enforcement yet. The orchestrator should only run in parallel what it's comfortable reviewing file by file.

---

## 3a. Mini plan: 0.0.3 and the easy review decisions

Approved 2026-09-29; **done 2026-09-29**, approved by you: #18, #20–#24 and the `v0.0.3` release. Added along the way: `--help` for the `npm create` launcher (#22). Implements decisions 17–27. Ratings as in §3; models, your choice: **I** Opus 5.5, **R** Sonnet 5.5, orchestrator Opus.

- **M1 Plan pull request** (D, orchestrator): decisions 17–27 in §1, this section, the AGENTS.md changes (§0, §1, §2, §4, §7, §8, §9) and the §6 proposals from the review. The handoff moves to `planning/`. **You:** yes to merge (it changes AGENTS.md).
- **M2 GitHub settings** (R, orchestrator, after M1): ruleset allows only squash and rebase, requires linear history, and requires CodeQL. **Break-it:** a merge-commit attempt is refused.
- **M3a Gate changes** (I, subagent, ∥ M2 and M3b): `--help` and `-h` on every command; `format:check` required; a pass lists the checks. Package READMEs made factually accurate; you see the diff first. Scope: `packages/*/src/**` except `src/testing/`, and `packages/*/README.md`.
- **M3b Test isolation** (R, subagent, ∥): scope `src/testing/`, `e2e/support/`, a setup file under `scripts/`; the root `package.json` change is the orchestrator's. **Break-it:** a global config with signing on fails a test without the isolation and passes with it.
- **M4 Release 0.0.3** (D, orchestrator with you, after M3a and M3b): bump PR; tag after your yes; the workflow stages both packages. **You:** approve on npmjs.com with 2FA, then move `latest`. **Check:** provenance.
- **M5 Pin 0.0.3** (D, orchestrator, after M4): pin in its own PR; CI runs `pnpm gate` and `pnpm build`; `pnpm check` becomes an alias for the gate; `scripts/check-lengths.ts` goes. **Break-it:** a misformatted file fails CI through the pinned gate. **You:** yes to merge (it bumps the pin).
- **Done when:** M5 is merged with its break-it evidence, and you approve.
- **Not in it:** your README rewrite; open review items (worktree location, cross-provider PR review, the remaining 1.5 and 1.7 findings, the refused fast-forward after setup, worktree setup scripts, copying env vars into worktrees, incident curation, what temple-bar dictates about planning).

---

## 4. Layer 2 — later phases (outline, waiting on decisions)

**Waiting on first:** your grouping of what goes into the first real release, then the open questions listed at the end of this section.

The themes below are grouped by the problem they solve. They are **not ordered**: the order is yours. Where one theme technically needs another first, it says so.

### Theme A — Set up fully; the core can't be trimmed

- The full `AGENTS.md` template, starting with "ask what we're building" (decision 5). It also carries the prose rules: P4.2–4.7 on verification, P5.1–5.5 on delegation, P6.1–6.3 on plans and proportionality, and P7.1 on security review.
- The core-presence check in the gate (P1.1). A mid-setup repo passes its gate (P1.6). Upgrades and release notes that name incidents (P1.3).
- The `init` regressions from §4: N6, N7, N9, and N10 (a README still pointing at files that don't exist).

### Theme B — A gate that can't be quietly weakened

- The rest of the base checks: markdown lint, the local link check (F9, N10), gitleaks through the verified-download helper.
- Stack detection beyond npm scripts (D2).
- **Rules may not shrink** (P3.2): inline suppressions, ESLint's effective config, ignore lists, tsconfig excludes, test `.skip`/`.only`/retries, and deleted CI jobs. Shrinking needs an ADR in the same change. Plus canaries per rule (D3.1) and the machinery-change notice at merge (D3.3).
- **D3.2 redesign:** which copy of the checks judges a PR, given that PR CI runs the PR's own workflow.
- The target matrix (decision 15), unused files and exports with knip (P3.6), and claims-must-cite-checks (P3.5).

### Theme C — `main`, remaining pieces

- Re-check whether the D4 pre-merge-commit guard and the P2.2 bypass ledger still add anything now that decision 4 exists. Delete whichever fails the deletion test.
- P2.5: merge requests state any machinery changes and any waiting incident proposals.
- **Commit messages enforced, not prose** (added 2026-09-29): a `commit-msg` hook refusing a subject without a conventional prefix; a CI check on the pull request title, since a squash merge turns it into the commit on `main`; a `temple-bar merge` command that writes the squash message (title subject, one bullet per change, co-authors once) and merges. The rule also goes into theme A's AGENTS.md template.

### Theme D — Subagents boxed in

- Scope locks (N2), with overlapping claims refused (N15). Subagents can't merge (P2.4, F6).
- The P3.4 branch-start check (decision 16).
- Worktree harm checks: dependencies, env keys and copies, port ranges allocated per worktree (decision 16).
- Detect worktrees nested inside the repo (not git-ignored, reached by ESLint, or running on the main checkout's `node_modules`), whichever harness made them (decision 30).
- The fixed handoff report (P5.3).
- Harness hooks (P5.6): **waiting on Q8.**
- Depends on theme E's worktree ids.

### Theme E — Status you can trust

- The status contract and exported types, partial updates (N14), the live log, and pruning on branch end or worktree removal (N20).
- The tracker-freshness nudge (N4, N11), the `waiting_on` field, and phone-width output (P6.4).
- The session handoff note, which needs a real trigger rather than a request (P6.6).

### Theme F — The incident loop

- Capture: agents propose, you curate. The gate prompts once per branch (N5, P8.4). Each entry stamps its harness and version (P8.1, F13). Nothing ranks entries for you (P8.5).
- Upstream filing, redaction and curation without a terminal: **waiting on Q7.**

### Final pass — showcase quality (after every theme; decision 29)

- Replace plan-ID references in code comments (45 in 19 files at 0.0.3) with plain-language reasons, and history in comments with git and ADRs.
- Remove repetition a critical reviewer would point at.
- A newcomer's map: how the command router, commands and seams fit together, and where to start reading.
- ADRs for every contested choice not already covered by a decision.

### Open questions (to settle while phase 1 is built)

1. **Your grouping:** which themes and items go into the first real release.
2. **Q6:** whether futura-maximila migrates, and when.
3. **Q7:** upstream filing (5 options), redaction (P7.2), and curation without a terminal (P8.3).
4. **Q8:** which harnesses get harness hooks, and for which tools.
5. **After phase 1:** an automatic PR review by an agent from a different provider (for example Gemini or ChatGPT), triggered by tagging it on GitHub, so a second model family reviews every PR. Which theme it belongs to, and whether its verdict is advisory or blocking, are yours to decide. (Added 2026-09-29.)
6. **Once `0.0.2` works: rewrite the README.** It's too front-loaded. It should say simply and quickly what temple-bar actually does and how to use it, before any of the background (the vision, the incident loop, the name). (Added 2026-09-29.)

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
| §4 regressions                          | Phase 1: N1, F12. Theme A: N6, N7, N9, N10. Theme B: F5. Theme D: F1, N2, N15. Theme E: N11, N14 |

---

## 6. Incidents proposed during phase 1

No incident tool exists until theme F. Agents write proposals here, one line each, and you curate them later.

- 2026-09-28: v1's merge-method rule (quick change squashed onto `main`; feature branch fast-forwarded, one commit per phase) was dropped when 1.1 rewrote branching for pull requests, so PRs #1 and #2 landed as merge commits. The same pattern as F11. To discuss after phase 1: squash or rebase only, linear history in the ruleset.
- 2026-09-29: 1.6's e2e tests created temp repos that inherited the developer's global `commit.gpgsign=true`, so they failed locally in agent sessions (no pinentry) but passed on CI (no signing). The handoff had recorded "68 of 68 pass" from a run that only passed because a passphrase was cached. Fixed with a shared `initTestRepo` helper; a suite-wide `GIT_CONFIG_GLOBAL` isolation is proposed.
- 2026-09-29: 1.6 was reviewed and reported green on macOS only. Its first CI run failed 11 tests on Windows: the fake fs didn't normalise path separators, and the `proc` seam refused every non-allowlisted command on win32, including `node`. Windows was left for CI to prove, and only CI caught it.
- 2026-09-29: 1.5's handoff reported break-it evidence for every hook, but review found three tests that passed with their check broken: a pre-commit test that the other hook satisfied, a cherry-pick test where git rejected `--no-verify` before any hook ran, and refusal tests that only checked for a non-zero exit. A red run shows a test _can_ fail; it doesn't show the test fails for the right reason. Fixed by asserting each hook's own refusal message.
- 2026-09-29: 1.7's `init` ruleset call had never run against real `gh`, and its unit test asserted the arguments it built, so it copied three bugs instead of catching them: `gh api -f` put the pull-request parameters on the wrong rule, sent `exclude` as `[""]`, and used the rule type `non_fastforward` (GitHub's is `non_fast_forward`). GitHub would have rejected it every time, and `init` would still have exited 0. Found by capturing `gh`'s request locally and reading the repo's real ruleset; replaced with a JSON body on stdin. Tests that assert what the code builds can't catch a wrong spec: check against the real thing once.
- 2026-09-29: #5 changed the shared fake filesystem after checking only its own branch for tests that read the fake directly. The parallel 1.7 branch did, and its first CI run failed 11 tests on Windows. A change to shared test code needs checking against every open branch, not just the one it's made on.
- 2026-09-29: 1.9's release workflow published directly, but the trusted publishers were set to staged publishing only, so the `v0.0.2` run got a 403. Nothing before a real release run could have shown the mismatch. Fixed in #15 with `npm stage publish`.
- 2026-09-29: after #16, fast-forwarding local `main` in the main checkout was refused. `init` in a worktree had set `core.hooksPath` in the config shared by every worktree, so the fast-forward checked out `.githooks/` before `temple-bar` was installed there, and the shim failed closed. Git left `main` at the old commit with the new tree staged. Recovered with `pnpm install` and a retried fast-forward. Worktrees on branches from before the setup have no hooks at all, silently. To discuss: worktree setup scripts.
- 2026-09-29: AGENTS.md §4 says the pinned gate is the merge condition from 1.10, but CI still runs the source tree's `pnpm check`, not `pnpm gate`. The gate also skips `format:check`, and the length cap is checked twice (`scripts/check-lengths.ts` and the gate).
- 2026-09-29: in the review, the agent folded "README rewrite: first task of the next phase" into its own implementation plan. You write the README; the decision said when, not who. A decision with no owner invites the agent to assume it's the owner.
- 2026-09-29: M3a's brief allowed `e2e/pack-install` to change "only if its fixture needs format:check", but an assertion on the gate's changed message also had to change. Briefs should name assertions on changed messages, not only fixtures. (Proposed by the M3a subagent.)
- 2026-09-29: 1.9's review listed what the release must defend against (tokens, provenance, only from `main`, lockstep, no overwrite) but not "never publish code that hasn't passed the full CI". "On `main`" was taken to mean tested, and the release's own Ubuntu-only check to mean fully tested. The release could stage before the 3-OS CI finished. Found by your question at 0.0.3, not by a mechanism; the fix is the next PR.
