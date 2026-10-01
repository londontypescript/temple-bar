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
| One concern per pull request              | `temple-bar pr-size` warns, once this repo pins it   | **Warned** only       |
| CodeQL passes before merge                | required check, from M2                              | **Blocked** from M2   |
| Squash merges only on `main`              | ruleset: squash only, linear history; repo settings  | **Blocked** on GitHub |
| Signed commits on `main`                  | ruleset: required signatures (GitHub signs squashes) | **Blocked** on GitHub |
| No commits to the local default branch    | pinned temple-bar hooks, once installed              | **Blocked** locally   |
| Local default branch moves only to GitHub | pinned `reference-transaction` hook                  | **Blocked** locally   |
| File length                               | the pinned gate in CI                                | **Blocked** via CI    |
| Delegated file scopes                     | nothing until theme D                                | **Prose only**        |
| No weakened checks                        | nothing until theme B                                | **Prose only**        |
| Who merges without asking                 | nothing                                              | **Prose only**        |
| Commit-message format                     | `commit-msg` hook, once this repo pins it            | **Prose only**        |
| Pull request title format                 | `temple-bar pr-title` in CI, once this repo pins it  | **Prose only**        |
| No force-push of a feature branch         | `pre-push` hook, once this repo pins it              | **Prose only**        |
| Size warned before a push                 | `pre-push` hook, once this repo pins it              | **Prose only**        |
| Comments in plain words, no plan IDs      | nothing                                              | **Prose only**        |
| Plan before code                          | nothing                                              | **Prose only**        |
| Tracker updated per subtask               | nothing                                              | **Prose only**        |
| Intake stays the user's                   | nothing                                              | **Prose only**        |
| Whether wide changes mean duplication     | nothing: judgement                                   | **Prose only**        |
| Worktree per branch; merge steps (§2)     | nothing until `temple-bar merge` and worktree setup  | **Prose only**        |
| Push once, when finished                  | nothing until `temple-bar ready`                     | **Prose only**        |
| AGENTS.md within 200 lines and 32 KiB     | the gate from 0.0.5, once this repo pins it          | **Prose only**        |
| Incident asked about, filed as an issue   | nothing until theme F                                | **Prose only**        |

A rule that exists only as prose is a rule that will eventually be broken. If
you find one drifting, the fix is a mechanism, not stronger wording. When a
mechanism ships, shrink its rule in AGENTS.md to one line.
