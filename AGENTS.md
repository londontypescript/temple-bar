# Agent directives

Binds every agent and human working here: this repo's own rules first, then
temple-bar's block below. This is the only copy; harness config may duplicate
a rule to fail faster, never replace it.

## This repo

- **Gated by the last published temple-bar.** Its own source never runs as its
  tooling, and no feature may make it do so. CI runs the pinned `pnpm gate`
  (`pnpm check` is the same). A pin bump is its own pull request, never a side
  effect of other work.
- **Decisions are numbered,** indexed in [docs/adr/](docs/adr/README.md). A new
  one takes the next number and an ADR, with its row, in the same pull request.
- **The repo is public.** Nothing committed or filed here carries anything from
  another project beyond its name and a one-line incident summary.
- **Incidents are this repo's own issues:** here, the block's "never in this
  repo" means never in another project's. Propose them generously. The user
  curates them; never rank or regroup them. When you ask for a merge approval
  or report a merge, name any incident still to triage (no milestone, no
  comments).
- **One pull request per phase,** merged in order; a release is a milestone and
  a tag, never one big pull request. The plan's ownership list is the claim on
  files.
- **A subagent's done-condition sits inside its scope** ("report back with the
  known failure" is valid). One that struggles is stopped and reported.
- **The primary checkout stays on `main`.**
- **Never route around a refusal through the user's terminal.**
  `corepack enable` is a global install too, like `npm i -g` and
  `brew install`. A workaround names its cause; one you can't find is
  _needs a decision_.
- **[docs/enforcement.md](docs/enforcement.md)** lists which rules are blocked
  and which are prose only: update it with any change to a mechanism. A rule
  that drifts needs a mechanism, not stronger wording.
- **Performance work freezes a baseline before building:** its plan names the
  benchmark, the commits and the target, and it is done on that benchmark's
  result, never on ordinary CI times.
- **A long CI experiment smoke-tests first:** one round with fail-fast, and the
  full run only once that round is clean.

<!-- BEGIN:temple-bar: setup rewrites this block; edit outside it -->

## Start here

For a new project, or a request whose goal isn't clear: ask the user what
we're building and who it is for, before anything else. Then plan. Before
writing code, read [docs/conventions.md](docs/conventions.md). The reasons
behind these rules are in [docs/agents-rationale.md](docs/agents-rationale.md).

## Plans

Before planning or filing an issue, read [docs/planning.md](docs/planning.md).

- **Plan first.** Work bigger than a one-line fix starts with a written
  plan the user has approved: verifiable phases, which can run in parallel,
  each rated **routine**, **involved** or **delicate**. Never pick or
  switch models yourself.
- **Scope is the user's,** set by placing issues in a milestone. Its plan,
  `docs/plans/<milestone>.md`, groups the issues into phases by the files
  they touch, gives each phase closing several its `One concern:` reason,
  and is approved through a pull request. Progress goes on the issues,
  never in the plan.
- **Settle questions early.** An issue has **Decided** and **Open
  questions** sections from filing. A plan is approved only when none of its
  issues' questions remain or each is marked "agent decides". A new
  question mid-build is asked with its background restated.
- **Decisions become ADRs** in `docs/adr/`, approved by the user. Check
  every premise against the ADRs and git history, not memory; a new issue
  cites what set the current state.

## Tracking and sessions

- **The issue is the tracker:** update it at every subtask, not at phase
  end. Drafts go in `.temple-bar/`, this checkout's gitignored folder.
- **One GitHub reference per line** in anything posted to GitHub, nested
  under its bullet in a pull request description.
- **Before work stops** (a compact, a pause, a usage limit, a change of
  tool), and on resume, read
  [docs/phase-boundaries.md](docs/phase-boundaries.md). Write the state on
  the issue in its fields, and post it only after the user has seen the
  exact text and said yes.
- **Clear or compact only at a phase boundary,** and ask first. On resume,
  read git, pull requests and the issue; never ask the user to remember.
- **Name the session,** where the tool allows, after the project and the
  work once both are known, and rename it when the work moves on.

## Branches and commits

- **The default branch changes only through merged pull requests,** each
  squashed: one branch, one pull request, one commit. Never commit to it
  directly, even a one-line fix.
- **Every branch gets its own worktree,** created by your harness and
  prepared there. Never run `git worktree add` or choose a location
  yourself; if the harness can't, ask the user once per session.
- **Commit at every point where the checks pass,** and a clean baseline
  before debugging. Never hold a large uncommitted change.
- **Read history before changing code** (`git log -S`, `git blame`).
- **Commit messages and pull request titles** take a conventional prefix
  (`feat`, `fix`, `docs`, `chore`) and name the change, in proportion to
  it, never the trigger.

## Pull requests and merges

Before opening a pull request or preparing an admin merge, read
[docs/pull-requests.md](docs/pull-requests.md).

- **Push once, when finished,** and for anything that needs the user's
  yes, once they have agreed it. `pnpm ready` runs the gate and marks the
  commit; the `pre-push` hook refuses an unmarked one.
- **One concern per pull request.** One closing two or more issues, or over
  the size limits, needs a `One concern:` line giving a reason that counts.
- **One bullet per distinct change** in the description, as a top-level
  list; it becomes the squash commit.
- **Merge with `pnpm merge <N>`** once CI and code scanning are green, from
  the default-branch checkout, never inside a pull request's worktree.
- **The user's yes first** for a change to AGENTS.md or to the checks, or
  one that tags or publishes. Never rewrite a pushed branch.
- **A change to the checks the judge guards** is merged by the user as
  admin: its description is exactly the squash body, its checklist a
  comment. Any other refusal is a failure to diagnose, not a bypass.

## Checks and verification

CI runs `pnpm gate`: the project's checks and temple-bar's own. The full
suite runs whatever changed.

- **The gate's scripts are real:** `typecheck`, `lint`, `format:check` and
  `test` run the right commands for this stack, never no-ops.
- **Never weaken a check,** suppress a rule or skip a test to make it
  pass: fix the cause, or change the check in its own reviewed change.
- **With no clean fix, stop and report.**
- **A refusal is a stop, not a detour.** When a sandbox, permission check
  or hook refuses something, stop and report. Never install globally.
- **Break-it evidence for every new check:** disable the fix, show the
  check fail with its own message, then restore it.
- **Diagnose before working around.** "Flaky" is not a diagnosis.
- **Two strikes, then stop:** after two failed attempts at one fix, or the
  user saying twice it's still broken, go back to the last clean commit,
  search upstream issues and changelogs, and report.
- **Verified means exercised through the real delivery path** (the built
  app, the packed package). Until a CI run is green, say "passes locally;
  CI not yet seen".
- **Tests assert behaviour worth protecting.** Don't pad the count.

## Security

- **Review every change that touches authentication,** user input,
  secrets, file or network access, or dependencies before its pull request,
  and say what you checked: injection, secrets in code or logs, unsafe
  defaults, where a new dependency comes from.
- **Never commit secrets or private details** (customer data, internal
  hostnames) in code, issues or commit messages.

## Delegation

Before delegating, or reporting back as a subagent, read
[docs/delegation.md](docs/delegation.md).

- **Delegate to keep the reviewer's context clean.** Justify parallel work,
  never split it across overlapping files, and don't edit a delegated file
  until its subagent reports.
- **Subagents commit only.** Shared files (root `package.json`, the
  lockfile, tsconfig, lint config) and every merge and push are the
  orchestrator's.
- **A handoff report** says what is resolved, deliberately deferred and
  needs a decision, gives break-it evidence for each new check, and says
  whether anything ran outside the sandbox.
- **Review every line** of a subagent's change: list what it must defend
  against, and check each item. Rerunning the checks is not a review.

## Code

- **File length** is capped by the gate. Split along seams; never raise the
  cap to fit.
- **Deep modules**, and **seams** around the filesystem, network, clock and
  prompts so tests can fake them.
- **Comments explain why, in plain words.** No task IDs; history belongs in
  git and ADRs.
- **Wide changes:** when a change touches many files, ask out loud whether
  they duplicate each other. If they do, fix that instead, and record the
  replaced choice as an ADR.

## Incidents

When something goes wrong (rework, confusion, a rule that made things
harder or was broken, the user saying twice it's still broken), read
[docs/incidents.md](docs/incidents.md). Search temple-bar's issues first:
name a match as the known gap; propose an incident only if none matches.
File or comment only on the user's yes, never in this repo.

Keep this file within 200 lines and 32 KiB (the gate checks). When it grows
past them, move this project's own text to docs, never this block.

<!-- END:temple-bar -->
