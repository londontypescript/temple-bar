# What is actually enforced

Which of the rules in [AGENTS.md](../AGENTS.md) something actually stops, and
which rely on agents and people following them. Stated plainly so no rule is
mistaken for a control. This table describes the repo today; update it in the
same pull request as any change to a mechanism.

| Rule                                                   | Mechanism                                                                                                        | Strength                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `main` changes only through pull requests              | GitHub ruleset on `main`                                                                                         | **Blocked** on GitHub               |
| No force-push or deletion of `main`                    | GitHub ruleset on `main`                                                                                         | **Blocked** on GitHub               |
| CI passes before merge                                 | required status checks (U6)                                                                                      | **Blocked** on GitHub               |
| One concern per pull request, or a `One concern:` line | `merge` refuses oversize or 2+ issues without it; CI warns                                                       | **Blocked** by merge                |
| CodeQL passes before merge                             | ruleset `code_scanning` rule, checked by the gate                                                                | **Blocked** on GitHub               |
| Squash merges only on `main`                           | ruleset: squash only, linear history; repo settings                                                              | **Blocked** on GitHub               |
| Signed commits on `main`                               | ruleset: required signatures (GitHub signs squashes)                                                             | **Blocked** on GitHub               |
| No commits to the local default branch                 | pinned temple-bar hooks, once installed                                                                          | **Blocked** locally                 |
| Local default branch moves only to GitHub              | pinned `reference-transaction` hook                                                                              | **Blocked** locally                 |
| File length                                            | the pinned gate in CI                                                                                            | **Blocked** via CI                  |
| Delegated file scopes                                  | nothing until theme D                                                                                            | **Prose only**                      |
| No weakened checks                                     | nothing until theme B                                                                                            | **Prose only**                      |
| Who merges without asking                              | nothing                                                                                                          | **Prose only**                      |
| Commit-message format                                  | `commit-msg` hook; skipped by `--no-verify`                                                                      | **Blocked** locally                 |
| Pull request title format                              | `temple-bar pr-title` in CI                                                                                      | **Blocked** via CI                  |
| No force-push of a feature branch                      | `pre-push` hook; skipped by `--no-verify`                                                                        | **Blocked** locally                 |
| Size warned before a push                              | `pre-push` hook                                                                                                  | **Warned** only                     |
| Comments in plain words, no plan IDs                   | nothing                                                                                                          | **Prose only**                      |
| Plan before code                                       | nothing                                                                                                          | **Prose only**                      |
| Multi-issue phase states its One concern               | nothing until #230                                                                                               | **Prose only**                      |
| Issue premise checked against history                  | nothing                                                                                                          | **Prose only**                      |
| Performance work benchmarked against a frozen baseline | nothing                                                                                                          | **Prose only**                      |
| Long CI experiments smoke-tested first                 | nothing                                                                                                          | **Prose only**                      |
| Tracker updated per subtask                            | nothing                                                                                                          | **Prose only**                      |
| Milestone scope stays the user's                       | nothing                                                                                                          | **Prose only**                      |
| Whether wide changes mean duplication                  | nothing: judgement                                                                                               | **Prose only**                      |
| Worktree per branch; merge steps                       | `pnpm merge` (`temple-bar merge`); nothing forces its use                                                        | **Prose only**                      |
| Main checkout stays on the default branch              | `post-checkout` hook warns on a switch or detach                                                                 | **Warned** only                     |
| Push once, after the gate passed                       | `ready` + `pre-push` from the pin that ships them                                                                | **Blocked** locally                 |
| Branch caught up with the default branch before ready  | `ready` fetches it and refuses a behind branch, from 0.2.0                                                       | **Blocked** locally                 |
| Maintainer asked in chat before a push                 | `ready` and `pre-push` warn; see the limits below                                                                | **Warned** only                     |
| Maintainer's yes for an AGENTS.md merge                | `merge` needs `--maintainer-approved`, records it                                                                | **Detected** after                  |
| AGENTS.md within 200 lines and 32 KiB                  | the pinned gate in CI                                                                                            | **Blocked** via CI                  |
| temple-bar's AGENTS.md block present and unedited      | the pinned gate in CI; from 0.2.0, also when AGENTS.md or its block is missing                                   | **Blocked** via CI                  |
| Ruleset not deleted or loosened                        | the pinned gate in CI (public repos)                                                                             | **Blocked** via CI                  |
| Check changes merged by the maintainer                 | judge workflow + its ruleset, from 0.0.7; see below                                                              | **Blocked** on GitHub               |
| temple-bar's lockfile entries unchanged                | the judge, from 0.0.8                                                                                            | **Blocked** on GitHub               |
| temple-bar.config.json limits unchanged                | the judge, from 0.0.8                                                                                            | **Blocked** on GitHub               |
| Bypass merges seen by the maintainer                   | `merge` lists the past month's, from 0.0.8                                                                       | **Detected** after                  |
| Judge's ruleset still required                         | the pinned gate in CI (public repos), from 0.0.7                                                                 | **Blocked** via CI                  |
| Gate and title checks required on `main`               | `main` ruleset, gate (public repos), from 0.0.9                                                                  | **Blocked** on GitHub               |
| Gate and title workflows unchanged                     | the pinned gate in CI, from 0.0.9                                                                                | **Blocked** via CI                  |
| Every workspace package's four scripts present and run | the gate, from 0.1.0                                                                                             | **Blocked** via CI                  |
| TypeScript files type-checked, test files run          | the gate, from 0.2.0 (inclusion, not strictness)                                                                 | **Blocked** via CI                  |
| The parts of a split gate add up to the whole gate     | `temple-bar gate --verify-parts` in CI, on the Windows legs, from G2                                             | **Blocked** via CI                  |
| Every package's scripts unchanged                      | the judge, from 0.1.0                                                                                            | **Blocked** on GitHub               |
| pnpm's install settings unchanged at any depth         | the judge, from 0.1.0                                                                                            | **Blocked** on GitHub               |
| Pin bump in its own pull request                       | the judge's refusal lists every other path, from 0.2.0                                                           | **Prose only**                      |
| Release notes finished before publishing               | `pnpm release:publish` refuses unfinished notes                                                                  | **Blocked** locally                 |
| Release tier passes before a release stages            | `release.yml`'s `publish` needs `release-check`, from 0.1.0                                                      | **Blocked** in the release workflow |
| Every promise keeps a pull-request-tier test           | the coverage map, checked in review                                                                              | **Prose only**                      |
| One-line description the same everywhere               | tests; About text by a CI step                                                                                   | **Blocked** via CI                  |
| Windows run after a failed CI Windows leg              | `pnpm windows-run --only <file>` first, the full `pnpm windows-run` when the failure isn't one file, run by hand | **Prose only**                      |
| Incident asked about, filed as an issue                | nothing until theme F                                                                                            | **Prose only**                      |
| Incident issues labelled, whoever files them           | `incident-label.yml` labels an `incident:` title                                                                 | **Detected** after                  |

Markdown integrity in the gate, from 0.0.10, uses markdownlint's
public structural tokens for actual local links/images and undefined explicit
full/collapsed reference labels. Comments, code and HTML raw-text examples do
not create references; balanced destinations are preserved. The fixed set
reads no project style configuration and cannot be disabled by generic lint
directives. Inline-code path mentions are not existence assertions. Packed
delivery regressions preserve framework documents and show genuine missing
targets and labels still fail. See the 0.0.10
[approved plan](plans/0.0.10.md).

Historical generated-output upgrades arrived in published 0.0.10:
setup replaces authentic published older hooks/workflows,
preserves edited or unrecognized content, and reports workflow conflicts.
Independent frozen npm output, release inventories and installed packed
regressions defend ownership and preservation. Existing shim/workflow bytes
and exact hook/workflow policy were unchanged by it.

Known limits of the required gate and title checks: the gate reads the rules
GitHub enforces on `main`, which don't show who may bypass them, so it can say
the checks are required, not that nobody can bypass them. And GitHub knows a
required check only by its name and the app that reports it, not by the
workflow that runs it. A pull request that deletes `temple-bar-gate.yml` and
adds a job of its own named `temple-bar gate` satisfies the rule; the judge
fails it, but an admin bypass of the judge's ruleset merges it, and from then
on CI never runs the real gate. That one bypass is visible only in `merge`'s
list of bypass merges, for a month. Agents use the maintainer's account, so
the bypass needn't be the maintainer's own act: the fix is agents with their
own GitHub identity
([#145](https://github.com/londontypescript/temple-bar/issues/145)), and until
then, noticing the removal on every later pull request
([#293](https://github.com/londontypescript/temple-bar/issues/293)).

Known limits of push-once ([ADR 0012](adr/0012-push-once-with-ready.md)):
`git push --no-verify` skips the `pre-push` hook, so CI and the ruleset stay
the final barrier (a skipped hook costs a red CI run, never a broken
`main`).

Known limits of the maintainer's yes (same ADR): this is detection, not
prevention. `ready` and `pre-push` only warn, and `--maintainer-approved`
is a claim the agent makes itself, which nothing checks. What it buys is
visibility: merge's summary lists each change that needs the yes, and the
squash commit carries a `Maintainer-Approved:` line, so a commit on `main`
that changes AGENTS.md without one was merged some other way and skipped
the request. Real enforcement needs agents to have their own GitHub
identity ([#145](https://github.com/londontypescript/temple-bar/issues/145)),
so GitHub itself can require the maintainer's code-owner review.

Known limits of the judge ([ADR 0011](adr/0011-which-checks-judge-a-pull-request.md)):
the maintainer merges a change to the checks through the judge's ruleset,
which lets the repository admin role past it through a pull request. Agents
use the maintainer's account, so GitHub can't tell that merge from an
agent's. `temple-bar merge` never makes it, and lists every one made on the
default branch in the past month, for the maintainer to recognise as theirs.
That is detection, not prevention, and only for a month: GitHub keeps its
rule history no longer, so a bypass made while no merge ran within the month
is seen only by reading that history directly.

A rule that exists only as prose is a rule that will eventually be violated. If
you find one drifting, the fix is a mechanism, not stronger wording. When a
mechanism ships, shrink its rule in AGENTS.md to one line.

From 0.0.10, the gate accepts only verified comment-only unused
JavaScript/TypeScript file findings (decision 59). A public Knip capture
reporter and bounded strict file reader preserve native diagnostics and all
real unused code, exports, types and analyzer failures. Packed SvelteKit
regressions exercise the exception and retained failures.

From 0.1.0, Knip still runs once at the root over the whole workspace, so a
shared package's code that only its sibling packages use counts as used. The
gate names the packages that hold Knip's findings, or the root; that naming
never turns a failure into a pass. temple-bar writes no Knip config: entries
that Knip's plugins don't find are declared in the project's own.

This repo pins published 0.2.0, so the rules marked "from 0.2.0" and earlier
apply to it: each of its two packages runs its own four scripts. The root's
`test` runs `scripts/` and `e2e/`, each package's runs its own `src/`, and a
test in the suite (`scripts/selected-tests.test.ts`) fails if any tracked test
file is run by none of them or by more than one.

The release scaffold checker validates the packed gate's complete check report,
exact per-framework missing-script expectations, verdict and exit code. Every
other local check must pass; only the four GitHub-rule checks may be skipped,
with the explicit isolated-origin reason. Missing, malformed or unexpected
reports fail compatibility. Authentic scaffold Markdown is recorded and its
bytes must survive setup; compatibility with missing scripts is not full gate
success. `pnpm scaffold-check` exercises all seven live scaffolders before a
release; it is an on-demand release check, not a required CI job.
The scaffold process runner waits for the Windows tree-stop command to finish
before returning from the parent-close path, and reports command failures.
Tests verify command completion ordering and that descendants stop writing
after termination; writes before the stop do not imply surviving descendants.
