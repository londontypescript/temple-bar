# Agent directives

Binds every agent working here (Claude Code, Codex, Antigravity or any other)
and humans: this repo's own rules first, then temple-bar's shared block. This
is the only copy. Harness config may duplicate a rule to fail faster, never
replace it.

## This repo

- **Gated by the last published temple-bar.** Its own source never runs as its
  tooling, and no feature exists to make it do so. CI runs the pinned
  `pnpm gate`; `pnpm check` is the same. Bumping the pin is a deliberate change
  in its own pull request, never a side effect of other work.
- **Decisions are numbered,** indexed in [docs/adr/](docs/adr/README.md). A new
  one takes the next number and an ADR, with its row, in the same pull request.
- **The repo is public.** Nothing committed or filed here carries anything from
  another project beyond its name and a one-line incident summary.
- **Incidents are this repo's own issues:** here, the block's "never in this
  repo" means never in another project's. Propose them generously. The user
  curates them; never rank or regroup them. When you ask for a merge approval
  or report a merge, name any incident still to triage (no milestone, no
  comments).
- **Phases:** a multi-phase plan gets one pull request per phase, merged in
  order; a release is a milestone and a tag, never one big pull request. The
  plan's ownership list is the claim on files. A subagent's done-condition sits
  inside its scope ("report back with the known failure" is valid). A
  struggling subagent is stopped and reported, never moved to another model.
- **Worktrees** go where the harness puts them; the primary checkout stays on
  `main`. **One concern** is settled when the work is planned; the `pre-push`
  size warning is the last check: split the branch, or say why.
- **An admin merge's squash message is written,** never GitHub's default: the
  title with `(#N)`, one plain-text bullet per change, each co-author once.
- **Never route around a refusal** through the user's terminal, and never
  install globally (`npm i -g`, `corepack enable`, `brew install`). A
  workaround names its cause; one you can't find is _needs a decision_.
- **[docs/enforcement.md](docs/enforcement.md)** lists which rules are blocked
  and which are prose only: update it with any change to a mechanism. A rule
  that drifts needs a mechanism, not stronger wording.

<!-- BEGIN:temple-bar: setup rewrites this block; edit outside it -->

## Start here

For a new project, or a request whose goal isn't clear: ask the user what
we're building and who it is for, before anything else. Then plan.

Stack conventions live in [docs/conventions.md](docs/conventions.md): read
them before writing code. The reasons behind these rules are in
[docs/agents-rationale.md](docs/agents-rationale.md).

## Plans

Non-trivial work starts with a written plan the user has approved, scaled to
the change: a one-line fix needs a branch, not a plan. Break the work into
verifiable phases, say which can run in parallel, and rate each one
**routine**, **involved** or **delicate** so the user can choose models.
Never pick or switch models yourself. Ask questions before the work, not
during it.

The user sets scope by placing issues in a milestone. Its plan is a short
file, `docs/plans/<milestone>.md`, approved through a pull request: you
group the issues into phases by the files each touches, and give each phase
that closes several issues its `One concern:` reason. Progress goes on
the issues, never in the plan.

Decisions agreed in discussion become ADRs in `docs/adr/`, from
[the template](docs/adr/0000-template.md), which the user approves. Briefs,
summaries and every issue's premise are checked against the ADRs and git
history, not memory; a new issue cites what set the current state (an ADR,
commit or pull request).

## Tracking and sessions

GitHub issues are the tracker: update the issue you work on **at every
subtask**, not at phase end. Drafts go in `.temple-bar/`, this checkout's
gitignored working folder.

**Before work stops** (a compact, a pause, a usage limit, a switch of tool;
judge it from what the user says), write the state on the issue: the base
commit (SHA) and the branch; the exact command that reproduces the problem
or proves the work is done; what has been ruled out, with the reason for
each; the next action. No private details. Show the user the exact text and
post it only after their yes (this update only, not routine ones).

Clear or compact only at a phase boundary, and ask first. On resume, read
git, open pull requests and the issue; don't ask the user to remember. How:
[docs/phase-boundaries.md](docs/phase-boundaries.md).

Where the tool lets you name the session, name it after the project and
the work as soon as both are known (`<project>: setup and design`), and
rename it when the work moves on: sessions titled from their first prompt
all look alike, and one that has moved on is hard to find again.

## Branches and commits

The default branch changes only through merged pull requests, each squashed:
one branch, one pull request, one commit. Never commit to it directly, even
a one-line fix. Every branch gets its own worktree.

- **Commit at every point where the checks pass.** Never hold a large
  uncommitted change; commit a clean baseline before debugging, so going
  back is safe.
- **Read history before changing code** (`git log -S`, `git blame`).
- **Commit messages** and pull request titles: a conventional prefix
  (`feat`, `fix`, `docs` or `chore`), proportional to the change, and a
  subject that names the change, never the trigger ("address feedback").

## Pull requests and merges

- **Push once, when finished.** Every push runs the full CI. Push when the
  work is final, and for anything that needs the user's yes, once they have
  agreed it. `pnpm ready` runs the gate and marks the commit; the
  `pre-push` hook refuses an unmarked one.
- **One concern per pull request.** One closing two or more issues needs a
  `One concern:` line giving a reason that counts (see the rationale doc).
- **Merge with `pnpm merge <N>`** from the default-branch checkout once CI
  and code scanning are green. It runs whatever that folder's
  `package.json` says, so never run it inside a pull request's worktree,
  where the pull request's own scripts would run. A change to AGENTS.md or
  to the checks, or one that tags or publishes, needs the user's yes first.
  The judge refuses a change to the checks it guards: the user merges that
  one as admin. Never rewrite a pushed branch.
- **One bullet per distinct change** in the pull request description, as a
  top-level list: merge turns the title and those bullets into the squash
  commit.

## Checks and verification

CI runs `pnpm gate`: the project's checks and temple-bar's own.

- **The gate's scripts are real.** `typecheck`, `lint`, `format:check` and
  `test` run the right commands for this stack, never no-ops.
- The full suite runs whatever changed. Never weaken a check, suppress a
  rule or skip a test to make it pass: fix the cause, or change the check
  deliberately in its own reviewed change. With no clean fix, stop and
  report.
- **A refusal is a stop, not a detour.** When a sandbox, permission check or
  hook refuses something, stop and report. Never install anything globally.
- **Break-it evidence for every new check:** disable the fix, show the check
  fail with its own message, then restore it.
- **Diagnose before working around.** "Flaky" is not a diagnosis.
- **Two strikes, then stop.** After two failed attempts at the same fix, or
  the user saying twice that it's still broken: go back to the last clean
  commit, search upstream issues and changelogs, and report. You may
  suggest a fresh subagent. The user saying it twice is also a moment to
  propose an incident.
- **Verified means exercised through the real delivery path** (the built
  app, the packed package), not only the source tree. Say "passes locally;
  CI not yet seen" until a CI run is green.
- Write tests that assert behaviour worth protecting. Do not pad the count.

## Security

Review every change that touches authentication, user input, secrets, file
or network access, or dependencies before its pull request: injection,
secrets in code or logs, unsafe defaults, where a new dependency comes from.
Say what you checked. Never commit secrets or private details (customer
data, internal hostnames) in code, issues or commit messages.

## Delegation

Delegate to keep the reviewer's context clean, not only to go faster.
Justify parallel work, and never split it across overlapping files. Don't
edit a file you delegated until its subagent reports back. Shared files
(root package.json, the lockfile, tsconfig, lint config) are the
orchestrator's. Subagents commit only; every merge and push is the
orchestrator's. A handoff report has three parts: _resolved_, _deliberately
deferred_, _needs a decision_, with break-it evidence for each new check, and
says whether anything ran outside the sandbox.

**Review bar.** The orchestrator reads every line of a subagent's change,
lists what it must defend against, and checks each item. Rerunning the
checks is not a review.

## Code

- **File length** is capped by the gate. Split along seams; never raise the
  cap to fit.
- **Deep modules**, and **seams** around the filesystem, network, clock and
  prompts so tests can fake them.
- **Comments explain why, in plain words.** No task IDs; history belongs in
  git and ADRs.
- **Wide changes:** when a change touches many files, ask out loud whether
  one change is spread across them or they duplicate each other. If they
  duplicate, fix that instead, and record the replaced choice as an ADR in
  `docs/adr/`, from [the template](docs/adr/0000-template.md).

## Incidents

When something goes wrong (rework, confusion, a rule that got in the way or
was broken), propose an incident to the user there and then. On a yes,
comment on a similar one in
[temple-bar's issues](https://github.com/londontypescript/temple-bar/issues)
or open one titled `incident: <what went wrong>`; never in this repo, never
with private details. temple-bar's maintainers curate them.

Keep this file within 200 lines and 32 KiB (the gate checks). When it grows
past them, move this project's own text to docs, never this block.

<!-- END:temple-bar -->
