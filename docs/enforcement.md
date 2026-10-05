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
| CodeQL passes before merge                | required check, from M2                              | **Blocked** from M2   |
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
| Tracker updated per subtask               | nothing                                              | **Prose only**        |
| Milestone scope stays the user's          | nothing                                              | **Prose only**        |
| Whether wide changes mean duplication     | nothing: judgement                                   | **Prose only**        |
| Worktree per branch; merge steps (§2)     | `temple-bar merge`; nothing forces its use           | **Prose only**        |
| Issues closed need a `One concern:` line  | `temple-bar merge` refuses without it                | **Blocked** by merge  |
| Push once, after the gate passed          | `ready` + `pre-push` from the pin that ships them    | **Blocked** locally   |
| Maintainer asked in chat before a push    | `ready` and `pre-push` warn; see the limits below    | **Warned** only       |
| Maintainer's yes for an AGENTS.md merge   | `merge` needs `--maintainer-approved`, records it    | **Detected** after    |
| AGENTS.md within 200 lines and 32 KiB     | the pinned gate in CI                                | **Blocked** via CI    |
| Ruleset not deleted or loosened           | the pinned gate in CI (public repos)                 | **Blocked** via CI    |
| Check changes merged by the maintainer    | judge workflow + its ruleset, from 0.0.7; see below  | **Blocked** on GitHub |
| Judge's ruleset still required            | the pinned gate in CI (public repos), from 0.0.7     | **Blocked** via CI    |
| Incident asked about, filed as an issue   | nothing until theme F                                | **Prose only**        |

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
agent's. `temple-bar merge` never makes it, but nothing yet reports one that
was made.

A rule that exists only as prose is a rule that will eventually be broken. If
you find one drifting, the fix is a mechanism, not stronger wording. When a
mechanism ships, shrink its rule in AGENTS.md to one line.
