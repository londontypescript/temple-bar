# ADR 0011: Which copy of the checks judges a pull request

Date: 2026-10-01. Status: accepted (decisions 41 and 42;
[#55](https://github.com/londontypescript/temple-bar/issues/55)). Not built
yet: building it is a separate issue.

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
- To prove on real GitHub before building on it: that a
  `pull_request_target` job's result counts as the pull request's required
  check, and what happens when a pull request adds a job with the judge's
  name. GitHub warns that duplicate job names make required checks ambiguous
  ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).
  If that lets a fake judge pass, the judge reports through a GitHub App set
  as the check's expected source, so only it can satisfy the check
  ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
  That costs an App and a private key secret per organisation.
- The ruleset lives outside the repo. The gate's check that the rulesets are
  still in place ([ADR 0004](0004-github-settings-temple-bar-applies.md))
  catches the judge being dropped from the required checks.

## What would end it

If London TypeScript moves to GitHub Enterprise Cloud, ruleset required
workflows replace the judge. If agents get their own GitHub identity, code
owner review replaces the bypass.
