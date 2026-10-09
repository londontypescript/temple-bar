# What is actually enforced

Which of the rules in [AGENTS.md](../AGENTS.md) something actually stops, and
which rely on agents and people following them. Stated plainly so no rule is
mistaken for a control. This table describes the repo today; update it in the
same pull request as any change to a mechanism.

| Rule                                      | Mechanism                                            | Strength              |
| ----------------------------------------- | ---------------------------------------------------- | --------------------- |
| `main` changes only through pull requests | GitHub ruleset on `main`                             | **Blocked** on GitHub |
| No force-push or deletion of `main`       | GitHub ruleset on `main`                             | **Blocked** on GitHub |
| CI passes before merge                    | required status checks (U6)                          | **Blocked** on GitHub |
| One concern per pull request              | `temple-bar pr-size` in CI                           | **Warned** only       |
| CodeQL passes before merge                | ruleset `code_scanning` rule, checked by the gate    | **Blocked** on GitHub |
| Squash merges only on `main`              | ruleset: squash only, linear history; repo settings  | **Blocked** on GitHub |
| Signed commits on `main`                  | ruleset: required signatures (GitHub signs squashes) | **Blocked** on GitHub |
| No commits to the local default branch    | pinned temple-bar hooks, once installed              | **Blocked** locally   |
| Local default branch moves only to GitHub | pinned `reference-transaction` hook                  | **Blocked** locally   |
| File length                               | the pinned gate in CI                                | **Blocked** via CI    |
| Delegated file scopes                     | nothing until theme D                                | **Prose only**        |
| No weakened checks                        | nothing until theme B                                | **Prose only**        |
| Who merges without asking                 | nothing                                              | **Prose only**        |
| Commit-message format                     | `commit-msg` hook; skipped by `--no-verify`          | **Blocked** locally   |
| Pull request title format                 | `temple-bar pr-title` in CI                          | **Blocked** via CI    |
| No force-push of a feature branch         | `pre-push` hook; skipped by `--no-verify`            | **Blocked** locally   |
| Size warned before a push                 | `pre-push` hook                                      | **Warned** only       |
| Comments in plain words, no plan IDs      | nothing                                              | **Prose only**        |
| Plan before code                          | nothing                                              | **Prose only**        |
| Multi-issue phase states its One concern  | nothing until #230                                   | **Prose only**        |
| Issue premise checked against history     | nothing                                              | **Prose only**        |
| Tracker updated per subtask               | nothing                                              | **Prose only**        |
| Milestone scope stays the user's          | nothing                                              | **Prose only**        |
| Whether wide changes mean duplication     | nothing: judgement                                   | **Prose only**        |
| Worktree per branch; merge steps (§2)     | `temple-bar merge`; nothing forces its use           | **Prose only**        |
| Main checkout stays on the default branch | `post-checkout` hook warns on a switch or detach     | **Warned** only       |
| Issues closed need a `One concern:` line  | `temple-bar merge` refuses without it                | **Blocked** by merge  |
| Push once, after the gate passed          | `ready` + `pre-push` from the pin that ships them    | **Blocked** locally   |
| Maintainer asked in chat before a push    | `ready` and `pre-push` warn; see the limits below    | **Warned** only       |
| Maintainer's yes for an AGENTS.md merge   | `merge` needs `--maintainer-approved`, records it    | **Detected** after    |
| AGENTS.md within 200 lines and 32 KiB     | the pinned gate in CI                                | **Blocked** via CI    |
| Ruleset not deleted or loosened           | the pinned gate in CI (public repos)                 | **Blocked** via CI    |
| Check changes merged by the maintainer    | judge workflow + its ruleset, from 0.0.7; see below  | **Blocked** on GitHub |
| temple-bar's lockfile entries unchanged   | the judge, from 0.0.8                                | **Blocked** on GitHub |
| temple-bar.config.json limits unchanged   | the judge, from 0.0.8                                | **Blocked** on GitHub |
| Bypass merges seen by the maintainer      | `merge` lists the past month's, from 0.0.8           | **Detected** after    |
| Judge's ruleset still required            | the pinned gate in CI (public repos), from 0.0.7     | **Blocked** via CI    |
| Gate and title checks required on `main`  | `main` ruleset, gate (public repos), 0.0.9, not here | **Blocked** on GitHub |
| Gate and title workflows unchanged        | the pinned gate in CI, from 0.0.9 (not yet here)     | **Blocked** via CI    |
| Release notes finished before publishing  | `pnpm release:publish` refuses unfinished notes      | **Blocked** locally   |
| One-line description the same everywhere  | tests; About text by a CI step                       | **Blocked** via CI    |
| Incident asked about, filed as an issue   | nothing until theme F                                | **Prose only**        |

Markdown integrity for the forthcoming 0.0.10 release uses markdownlint's
public structural tokens for actual local links/images and undefined explicit
full/collapsed reference labels. Comments, code and HTML raw-text examples do
not create references; balanced destinations are preserved. The fixed set
reads no project style configuration and cannot be disabled by generic lint
directives. Inline-code path mentions are not existence assertions. Packed
delivery regressions preserve framework documents and show genuine missing
targets and labels still fail. This repo's pinned 0.0.9 gate remains unchanged
until a separate release pin update: see the [approved plan](plans/0.0.10.md).

Historical generated-output upgrades are implemented for the forthcoming
0.0.10 release: setup replaces authentic published older hooks/workflows,
preserves edited or unrecognized content, and reports workflow conflicts.
Independent frozen npm output, release inventories and installed packed
regressions defend ownership and preservation. Existing shim/workflow bytes
and exact gate policy are unchanged; pinned 0.0.9 still judges this repo.

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

The forthcoming 0.0.10 source gate accepts only verified comment-only unused
JavaScript/TypeScript file findings (decision 59). A public Knip capture
reporter and bounded strict file reader preserve native diagnostics and all
real unused code, exports, types and analyzer failures. Packed SvelteKit
regressions exercise the exception and retained failures. This repository's
published 0.0.9 pin still has the earlier unused-file behavior.
