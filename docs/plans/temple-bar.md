# Plan: temple-bar

Status: **Layer 1 (phase 1) APPROVED 2026-09-28, in progress: 1.1–1.7 and 1.9 done (1.7 lands with its PR); 1.8 next.** Repo created with the `main` ruleset (U2 and U4 done). Layer 2 is still an outline.

Approval is in two layers, as agreed:

1. **Layer 1: Phase 1 (stage0)** is fully detailed below. Approving it lets the build start.
2. **Layer 2: later phases** are outlined only, each marked with what it's waiting on. Each one gets detailed and approved before it starts.

Inputs, kept outside this public repo in the user's local v1 repo (`nnsee-agentic`) and only read, never copied in: the brief (P1–P9, §4), the incident intake beside it (IDs F = futura-maximila, G = grand-union, N = nnsee-agentic), and the frozen hardening plan (D1–D7). The agreed README draft became `README.md`.

This file lives at `docs/plans/temple-bar.md` (P6.5) and is the progress tracker. Tick each checkbox as its subtask lands.

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

Brief items changed by these decisions (the rest stand as written):

- P1.1: "the gate _or doctor_" becomes the gate only.
- P2.1–P2.3: largely replaced by decision 4. The plan re-checks whether the pre-merge-commit guard and the bypass ledger still add anything.
- D3.2 "main's copy judges": still needed, but PR CI runs the PR's own workflow copy. Needs its own design (Layer 2, theme B).
- P5.7: replaced by decision 16.
- P6.6: replaced by decisions 13 and 14.

---

## 2. Your steps (things only you can do)

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | When       | Blocks |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| U1  | Add the trademark disclaimer to the org's profile page (decision 12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Any time   | —      |
| U2  | ~~Create the public repo with a README and MIT licence~~ **Done** 2026-09-28 (created by Claude with your go-ahead)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —          | —      |
| U3  | ~~Org security configuration~~ **Done** 2026-09-28: the org's enforced security configuration is the default for new public repos. On temple-bar: secret scanning, push protection, Dependabot alerts and security updates, and code scanning default setup are all on. The brief's `*_for_new_repositories` check is out of date; the configuration default is what applies. GitHub Free has no Advanced Security on private repos, so a separate free-features configuration (dependency graph, Dependabot) covers those. Private vulnerability reporting is on for temple-bar. | —          | —      |
| U4  | ~~Ruleset on `main`~~ **Done**: ruleset 24133476 "main: pull requests only" (PR required with 0 approvals, since you can't approve your own PR; no force-push; no deletion; no bypass). Required status checks come in U6.                                                                                                                                                                                                                                                                                                                                                        | —          | —      |
| U5  | ~~Install `pnpm` and `gh`, run `gh auth login`~~ **Done**: checked 2026-09-28, pnpm 10.34.5 (the version G13's subagent installed globally) and gh 2.101.0 signed in over SSH                                                                                                                                                                                                                                                                                                                                                                                                     | —          | —      |
| U6  | ~~Add the CI jobs to the ruleset as required checks~~ **Done** 2026-09-28: the six `check (<os>, node <n>)` jobs are required on the `main` ruleset (not strict; also enforced on creation).                                                                                                                                                                                                                                                                                                                                                                                      | —          | —      |
| U7  | Publish `0.0.1` of both packages by hand: clean checkout of the tagged commit, `npm login` with 2FA, `pnpm publish --tag next` for each                                                                                                                                                                                                                                                                                                                                                                                                                                           | After 1.9  | 1.10   |
| U8  | Add a trusted publisher to **each** package on npmjs.com (Settings → Trusted Publisher → GitHub Actions: org `londontypescript`, repo `temple-bar`, workflow `release.yml`)                                                                                                                                                                                                                                                                                                                                                                                                       | After U7   | 1.10   |
| U9  | Approve and merge each pull request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Throughout | —      |

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

- [ ] Pack both packages. In a temp git repo, install them from the tarballs **with npm and with pnpm**. Run the setup, then show that a commit to `main` is refused and the gate runs.
- [ ] Faking GitHub in the test: put a fake `gh` first on `PATH`, and use git's `url.<local>.insteadOf` so a `github.com` origin points at a local bare repo.
- **Done when:** green on all six CI jobs. This is the test that proves the published package works from `node_modules` (P9.1a, the G5 class of bug).

#### 1.9 Release workflow ∥ — **I**

- [x] `release.yml`, run by hand (`workflow_dispatch`) or on a version tag: build, `pnpm check`, then publish both packages in lockstep on the `next` tag, with `id-token: write`, npm ≥11.5.1 and provenance.
- **Done when:** the workflow is reviewed and merged. It can't run for real until U7 and U8 are done. **Done** 2026-09-28, [#3](https://github.com/londontypescript/temple-bar/pull/3). It publishes with `npm publish` (pinned npm), because `pnpm publish` doesn't support trusted publishing yet (pnpm/pnpm#9812).

#### 1.10 Stage0 release and self-protection — **D**, orchestrator with you

- [ ] Tag `v0.0.1`. **You:** U7 (manual publish), then U8 (trusted publishers).
- [ ] Bump to `0.0.2` in a PR. After you approve it, run `release.yml`. **Check:** both packages show provenance on npm.
- [ ] A PR that pins `@londontypescript/temple-bar@0.0.2` as a dev dependency of the repo and runs its `init`.
- [ ] **Break-it evidence in the real repo:** a commit to local `main` is refused; the gate runs.
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

### Theme D — Subagents boxed in

- Scope locks (N2), with overlapping claims refused (N15). Subagents can't merge (P2.4, F6).
- The P3.4 branch-start check (decision 16).
- Worktree harm checks: dependencies, env keys and copies, port ranges allocated per worktree (decision 16).
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

### Open questions (to settle while phase 1 is built)

1. **Your grouping:** which themes and items go into the first real release.
2. **Q6:** whether futura-maximila migrates, and when.
3. **Q7:** upstream filing (5 options), redaction (P7.2), and curation without a terminal (P8.3).
4. **Q8:** which harnesses get harness hooks, and for which tools.
5. **After phase 1:** an automatic PR review by an agent from a different provider (for example Gemini or ChatGPT), triggered by tagging it on GitHub, so a second model family reviews every PR. Which theme it belongs to, and whether its verdict is advisory or blocking, are yours to decide. (Added 2026-09-29.)

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
