# ADR 0011: Which copy of the checks judges a pull request

Date: 2026-10-01, revised 2026-10-04. Status: accepted (decisions 41 and 42;
[#55](https://github.com/londontypescript/temple-bar/issues/55)). Built in
[#147](https://github.com/londontypescript/temple-bar/issues/147) and
[#148](https://github.com/londontypescript/temple-bar/issues/148); see
"How it is built" below. Proven on real GitHub on 2026-10-03, with a
throwaway repo: see "The trial" below.

## Context

On a pull request, GitHub runs the workflow files from the pull request
itself, not from `main`
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
The `main` ruleset requires checks by job name, reported by GitHub Actions.
So one pull request can weaken the checks that judge it and still go green:

- edit `.github/workflows/ci.yml` so the `pnpm gate` step always passes,
  keeping the job names;
- change the pinned temple-bar in `package.json` to another version;
- change what the gate runs: the `typecheck`, `lint`, `test` or
  `format:check` scripts it calls.

Gating this repo by its last published release
([ADR 0006](0006-building-and-releasing-temple-bar.md)) protects the gate's
code, but not the files that decide whether and how it runs. The fix must
work for every London TypeScript repo on standard GitHub plans (today: a
free organisation, public repos, one maintainer whose account the agents also
use), and use Node built-ins only.

## Options

1. **Ruleset "require workflows to pass".** The right tool: the organisation
   names a workflow, pinned to a branch, tag or SHA, that every pull request
   must pass. It needs GitHub Enterprise Cloud
   ([changelog](https://github.blog/changelog/2023-10-11-requiring-workflows-with-repository-rules-is-generally-available/)),
   and organisation rulesets need Team or Enterprise
   ([docs](https://docs.github.com/en/organizations/managing-organization-settings/creating-rulesets-for-repositories-in-your-organization)).
   Out of reach on standard plans.
2. **CODEOWNERS with required code owner review** on the workflow files and
   `package.json`. Works on public repos without a paid plan, but "pull
   request authors cannot approve their own pull requests"
   ([docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews)).
   Agents open pull requests as the maintainer, so nobody could approve.
   Only useful once agents have their own GitHub identity.
3. **Run the gate under `pull_request_target`.** That trigger runs `main`'s
   workflow file, but running the pull request's code under it is what
   GitHub warns against: it has a privileged token and can be taken over
   ([secure use](https://docs.github.com/en/actions/reference/security/secure-use)).
   Rejected.
4. **A judge that runs from `main` and reads the pull request as data.** A
   small `pull_request_target` workflow that never checks out or runs the
   pull request's code. It runs the temple-bar pinned on `main`, reads the
   pull request's changed files through the GitHub API, and fails when they
   touch the checks. Its job is a required check on the `main` ruleset.
5. **Re-check after merging,** on the push to `main`. Catches it too late.

## Decision

**Decision 41:** option 4, a `temple-bar judge` job, set up in every repo.

**What it guards.** Any file under `.github/workflows/`, the temple-bar pin
in `package.json`, and the scripts the gate requires. A pull request that
leaves these alone, which is nearly every one, passes in seconds. Tool
configs (ESLint, tsconfig, Prettier) are left out to start with: they change
often, and guarding them would make bypass merges routine. Whether to add
them is decided once the judge has a record
([#144](https://github.com/londontypescript/temple-bar/issues/144)).

**Why it is safe.** `pull_request_target` always runs `main`'s copy of the
workflow, so a pull request that edits or deletes the judge doesn't change
what judges it. Reading a pull request as data, without running it, is the
pattern GitHub calls safe, and such workflows can't write to the shared cache
([securely using `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
The job's token is read-only, and the judge uses Node's built-in `fetch`.

**Decision 42: when it fails.** The pull request changes the checks, which already needs
the maintainer's yes ([ADR 0003](0003-how-a-change-reaches-main.md)). The
maintainer merges it through the ruleset's bypass, which GitHub records on
the pull request. `temple-bar merge` never bypasses.

**How that works day to day** (decided 2026-10-03, after the trial):

- The judge's ruleset lets the repository admin role past it, through a
  pull request only. Pin bumps, CI changes and gate-script changes are
  routine, and this is how the maintainer approves them.
- `temple-bar merge` refuses such a pull request before it waits for any
  check, even when told the maintainer said yes in chat, and says to ask
  the maintainer to review it and merge it themselves as a repository
  admin. The judge's own failure says the same, in the same words. Neither
  names the command or flag for that merge: no message temple-bar prints
  names a way past a check.
- `temple-bar ready` asks the user, typed in a terminal, about exactly the
  changes the judge refuses, as well as AGENTS.md, before such a commit is
  pushed. One function finds those changes for the judge, `ready` and
  `merge`, so the three can't disagree.
- One yes from the maintainer covers both rulesets when setup creates them
  together.
- The judge runs the pinned version with `npm exec`, as built.
- temple-bar's own repo switches the judge on during the 0.0.7 release:
  publish, then the judge workflow and its ruleset, merged by the
  maintainer as a repository admin, then the pin bump. A pin bump before
  that would be judged by a gate that fails for want of the judge's ruleset.
- From 0.0.7 the gate fails when the default branch doesn't require the
  judge's check (see "How it is built").
- Bypass merges are to be detected and reported from GitHub's rule-suite
  history, because an agent sharing the maintainer's credentials could
  imitate either approval. Until agents have their own identity that is
  detection, not prevention. It is not built yet: it needs its own trial
  of what GitHub reports and who may read it, and is planned for 0.0.8.

## How a change that weakens its own CI gets caught

A pull request changes the gate step in `ci.yml` to `run: echo ok`. Its own
CI goes green. The judge, running from `main`, sees `ci.yml` in the changed
files and fails, naming the file. The ruleset requires the judge, so the
pull request can't merge through the normal path. The same happens for a
changed pin or gate script. When it's built, a test pull request that does
exactly this must be refused, as break-it evidence.

## What it costs

- One more workflow and required check per repo, on one Linux runner.
- Real changes to workflows or the pin need the maintainer's bypass merge.
  These are rare and need their yes already.
- A `pull_request_target` workflow must never check out or run pull request
  code. Workflow invariant checks
  ([#109](https://github.com/londontypescript/temple-bar/issues/109)) could
  hold that rule, and CodeQL flags the unsafe pattern.
- An honest limit: agents use the maintainer's account, so GitHub can't tell
  the maintainer's bypass from an agent's. The change can no longer pass
  silently, but the bypass itself stays a written rule until agents have
  their own identity (then option 2 replaces it). Whether they get one is
  decided once the judge exists
  ([#145](https://github.com/londontypescript/temple-bar/issues/145)).
- The ruleset lives outside the repo. The gate's check that the rulesets are
  still in place ([ADR 0004](0004-github-settings-temple-bar-applies.md))
  catches the judge being dropped from the required checks.

## The trial

Before building on it, two things had to hold on real GitHub: that a
`pull_request_target` job's result counts as the pull request's required
check, and that a pull request can't fake it by adding a job with the
judge's name. GitHub warns that duplicate job names make required checks
ambiguous
([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
If a fake could pass, the fallback was a GitHub App set as the check's
expected source
([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)),
at the cost of an App and a private key secret per organisation.

On a throwaway repo, with a stand-in judge using the same trigger,
permissions, checkout and job name as the template
([#147](https://github.com/londontypescript/temple-bar/issues/147)):

- a normal change passed the judge and could merge; a change that turned the
  CI step into `echo ok` failed the judge and was blocked;
- a pull request that added its own `pull_request` job with the judge's
  name, passing after the real judge failed, stayed blocked, so the App
  fallback isn't needed;
- a plain merge of the blocked pull request was refused, and the
  maintainer's merge as a repository admin went through.

## How it is built

- **The command.** `temple-bar judge` reads the pull request, every page of
  its changed files, and, only when the root `package.json` changed, that
  file on the base branch and at the pull request's head, all through
  Node's `fetch`. It fails on any file under `.github/workflows/` (renames
  away included), on any change to where `package.json` sets temple-bar's
  version (the dependency lists and the `overrides`, `pnpm.overrides` and
  `resolutions` fields, since an override can swap the pin), and on the
  `gate` script or the four scripts the gate runs. It fails closed: an
  unreadable answer, or fewer files listed than the pull request has
  (GitHub stops at 3000), is a failure, never a pass.
- **The workflow** setup writes, `.github/workflows/temple-bar-judge.yml`.
  Its job, `temple-bar judge`, is the required check. It checks out only
  the base branch's `package.json` (sparse, no credentials kept), reads the
  exact temple-bar version pinned there, and runs that version with
  `npm exec`. Nothing from the base branch is installed, so no install
  script runs, and it doesn't depend on the repo naming a pnpm version.
  Its token is read-only and no pull request text reaches a shell. Tests
  assert each of these on the template.
- **The ruleset.** The judge's check is required by a second ruleset,
  `main: the judge`, beside the `main` ruleset rather than inside it.
  Setup creates it only once the workflow is on the default branch:
  requiring a check that never reports would block every pull request,
  the setup pull request included. On a repo setup creates from scratch
  the workflow is in the first commit; elsewhere a second run of setup
  after the setup pull request merges adds it. It requires the check from
  GitHub Actions on up-to-date branches, and lets the repository admin
  role past it through a pull request only: decision 42's merge, kept to
  this one rule, while the `main` ruleset keeps nobody past it.
- **The gate's check.** Beside its check of the `main` ruleset, the gate
  reads the same answer from GitHub and fails unless some active rule
  requires the judge's check from GitHub Actions on up-to-date branches.
  Another ruleset requiring other checks doesn't count against it. The one
  exception is the change that brings the judge workflow: until the
  workflow is on the default branch its ruleset can't exist, so a checkout
  carrying the workflow is skipped, with what to do once it lands. Without
  that, the setup pull request on an existing repo, or one that upgrades
  to this version, could never pass the gate. The exception can't be used
  to drop the judge: taking the workflow off the default branch is itself
  a change the judge refuses.
- **Setup's files.** The judge workflow counts as one of the files a
  project starts with, so a repo holding only what setup wrote still
  passes the gate without the four scripts.
- **The same list everywhere.** The judge, `ready` and `merge` find the
  guarded changes with one function, fed by the GitHub API in the judge
  and by git locally.

## What would end it

If London TypeScript moves to GitHub Enterprise Cloud, ruleset required
workflows replace the judge. If agents get their own GitHub identity, code
owner review replaces the bypass.
