# Decisions

Every decision about temple-bar has a number and an ADR in this folder. This
index gives each decision one line and links its ADR, which holds the rule as
it stands today, the reasons and what was rejected. The numbers are those of
the decisions list the plan kept until 0.2.0, so "decision 28" still means the
same thing.

Briefs, summaries and every issue's premise are checked against these ADRs. A
new decision takes the next free number, in an ADR made from
[the template](0000-template.md), and gets its row here in the same pull
request. A revised decision keeps its number, and its ADR says what changed and
when.

Settled before the numbering began:

- Repo, packages and MIT licence: [ADR 0002](0002-what-temple-bar-is-for.md)
- TypeScript on Node, Node built-ins only, bash only as hook shims: [ADR 0006](0006-building-and-releasing-temple-bar.md)
- Published to the npm registry only (no JSR): [ADR 0006](0006-building-and-releasing-temple-bar.md)
- Models: phases rated routine / involved / delicate; the maintainer picks models, temple-bar never does: [ADR 0002](0002-what-temple-bar-is-for.md)
- What became of the earlier hardening plan's D2, D3, D4 and D7: [ADR 0002](0002-what-temple-bar-is-for.md)

| #   | Decision                                                                              | ADR                                                |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | The README opens with a plain two-sentence intro, then setup, then the background     | [0009](0009-readme-and-agents-md.md)               |
| 2   | Public, highly opinionated, 0.x: a planned release bumps the minor, a fix the patch   | [0002](0002-what-temple-bar-is-for.md)             |
| 3   | GitHub only: a git repo, `gh` signed in, `origin` on GitHub                           | [0002](0002-what-temple-bar-is-for.md)             |
| 4   | `main` changes only through merged pull requests; hooks guard local `main`            | [0003](0003-how-a-change-reaches-main.md)          |
| 5   | Scaffold first, then setup through `pnpm create` layers on top; pnpm only             | [0005](0005-setup-hooks-and-worktrees.md)          |
| 6   | Stage0: plain checks, 3-OS CI and GitHub protection before the first release          | [0006](0006-building-and-releasing-temple-bar.md)  |
| 7   | temple-bar's repo is gated by its last published release, never its source            | [0006](0006-building-and-releasing-temple-bar.md)  |
| 8   | Only CI publishes, through npm trusted publishing with provenance                     | [0006](0006-building-and-releasing-temple-bar.md)  |
| 9   | pnpm workspaces, Node 24+, CI on 3 OSes; strict ESLint and Prettier                   | [0006](0006-building-and-releasing-temple-bar.md)  |
| 10  | Base-check tools: pinned tools; Markdown integrity, with style owned by projects      | [0007](0007-what-the-gate-checks.md)               |
| 11  | No timebox: the first real release is defined by scope                                | [0002](0002-what-temple-bar-is-for.md)             |
| 12  | Naming and the TypeScript logo are the organisation's; no disclaimer in temple-bar    | [0009](0009-readme-and-agents-md.md)               |
| 13  | No `doctor` command: hooks and the gate keep status truthful                          | [0008](0008-status-without-doctor.md)              |
| 14  | Status is a published, versioned contract with a live log per worktree                | [0008](0008-status-without-doctor.md)              |
| 15  | Each project declares delivery paths with end-to-end checks the gate runs             | [0007](0007-what-the-gate-checks.md)               |
| 16  | Worktrees go where the harness puts them; temple-bar checks the harms                 | [0005](0005-setup-hooks-and-worktrees.md)          |
| 17  | Squash merges only; one pull request per phase; linear, signed history on `main`      | [0003](0003-how-a-change-reaches-main.md)          |
| 18  | The orchestrator merges when green, except changes that need the maintainer's yes     | [0003](0003-how-a-change-reaches-main.md)          |
| 19  | Agents keep the README accurate; a rewrite or new structure is the maintainer's       | [0009](0009-readme-and-agents-md.md)               |
| 20  | `--help` runs nothing; a passing gate lists the checks that ran                       | [0007](0007-what-the-gate-checks.md)               |
| 21  | The README says hooks arrive with the install; nothing more for fresh clones          | [0005](0005-setup-hooks-and-worktrees.md)          |
| 22  | Hooks fail closed where temple-bar isn't installed yet                                | [0005](0005-setup-hooks-and-worktrees.md)          |
| 23  | The gate requires the four scripts once a repo has content, never as no-ops           | [0007](0007-what-the-gate-checks.md)               |
| 24  | Conventional, proportional commit messages, also for pull request titles              | [0003](0003-how-a-change-reaches-main.md)          |
| 25  | CodeQL is a required check on the `main` ruleset                                      | [0004](0004-github-settings-temple-bar-applies.md) |
| 26  | The test suite runs shut off from the machine's git config                            | [0006](0006-building-and-releasing-temple-bar.md)  |
| 27  | _Superseded by 37._ A gitignored `planning/` folder held progress and the handoff     | [0010](0010-plans-progress-and-incidents.md)       |
| 28  | grand-union adopts temple-bar, in place, once 0.2.0 ships; others go alongside        | [0002](0002-what-temple-bar-is-for.md)             |
| 29  | Working, standards-following code first; a showcase for TypeScript devs second        | [0002](0002-what-temple-bar-is-for.md)             |
| 30  | Worktree location stays each harness's choice; one inside the repo is made safe       | [0005](0005-setup-hooks-and-worktrees.md)          |
| 31  | Built for every London TypeScript repo; GitHub, `gh` and pnpm required                | [0002](0002-what-temple-bar-is-for.md)             |
| 32  | A `post-checkout` hook sets up every new worktree                                     | [0005](0005-setup-hooks-and-worktrees.md)          |
| 33  | `temple-bar merge` does the whole merge, cleanup included                             | [0003](0003-how-a-change-reaches-main.md)          |
| 34  | The same GitHub rulesets on every London TypeScript repo, signed commits included     | [0004](0004-github-settings-temple-bar-applies.md) |
| 35  | Push once, when the work is finished                                                  | [0003](0003-how-a-change-reaches-main.md)          |
| 36  | AGENTS.md stays within 200 lines and 32 KiB                                           | [0009](0009-readme-and-agents-md.md)               |
| 37  | GitHub issues are the tracker (supersedes 27)                                         | [0010](0010-plans-progress-and-incidents.md)       |
| 38  | Incidents improve temple-bar only, filed as its issues with no private details        | [0010](0010-plans-progress-and-incidents.md)       |
| 39  | No project board until grand-union, which then gets its own                           | [0010](0010-plans-progress-and-incidents.md)       |
| 40  | temple-bar applies a short fixed list of GitHub settings, not all of them             | [0004](0004-github-settings-temple-bar-applies.md) |
| 41  | A judge run from `main` refuses changes to workflows, the pin or gate scripts         | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 42  | The maintainer bypass-merges check changes; `temple-bar merge` never bypasses         | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 43  | The gate's ruleset check supports public repos only for now                           | [0004](0004-github-settings-temple-bar-applies.md) |
| 44  | A repo without AGENTS.md skips the size check rather than failing                     | [0007](0007-what-the-gate-checks.md)               |
| 45  | Hooks live in git's shared hooks folder, so every worktree has them                   | [0005](0005-setup-hooks-and-worktrees.md)          |
| 46  | Repository admins merge check changes past the judge, through a pull request only     | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 47  | `merge` refuses check changes; it and the judge both say to ask for the admin merge   | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 48  | `ready` warns about exactly the files the judge guards, from the judge's own list     | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 49  | Bypass merges are detected and reported from rule-suite history (from 0.0.8)          | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 50  | The gate fails without the judge's ruleset, except while its workflow is on its way   | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 51  | One maintainer yes creates both rulesets                                              | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 52  | The judge runs the pinned temple-bar with `npm exec`                                  | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 53  | temple-bar's own judge is switched on in the 0.0.7 release, before the pin bump       | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 54  | Merge refuses 2+ closed issues without a `One concern:` line                          | [0003](0003-how-a-change-reaches-main.md)          |
| 55  | Work is planned by milestone across the org; agents phase a milestone's issues        | [0010](0010-plans-progress-and-incidents.md)       |
| 56  | temple-bar's AGENTS.md block is never trimmed to make room; a project's text moves    | [0009](0009-readme-and-agents-md.md)               |
| 57  | One short plan file per milestone; decisions live in ADRs (for the template)          | [0010](0010-plans-progress-and-incidents.md)       |
| 58  | Of the tool configs, the judge guards only temple-bar.config.json                     | [0011](0011-which-checks-judge-a-pull-request.md)  |
| 59  | Unused files with only comments may pass; code, exports, types and failures block     | [0007](0007-what-the-gate-checks.md)               |
| 60  | Setup declares Node 24+ in `engines.node`, raising a plain lower `>=`                 | [0005](0005-setup-hooks-and-worktrees.md)          |
| 61  | temple-bar refuses a Node below its minimum before loading anything else              | [0005](0005-setup-hooks-and-worktrees.md)          |
| 62  | Before installing, hook and launcher check the pnpm that will run against the pin     | [0005](0005-setup-hooks-and-worktrees.md)          |
| 63  | The judge guards what decides how the gate runs, in every package, and no more        | [0015](0015-every-package-checked-and-guarded.md)  |
| 64  | The judge guards every script of every tracked `package.json`                         | [0015](0015-every-package-checked-and-guarded.md)  |
| 65  | A new package with scripts, or a removed one, needs the maintainer                    | [0015](0015-every-package-checked-and-guarded.md)  |
| 66  | `pnpm-workspace.yaml` stays guarded as a whole file                                   | [0015](0015-every-package-checked-and-guarded.md)  |
| 67  | The gate runs every package's checks and fails on a manifest outside the list         | [0015](0015-every-package-checked-and-guarded.md)  |
| 68  | Setup writes `ready`; the gate re-runs only the pnpm `npm_execpath` names, never PATH | [0017](0017-running-and-merging-workspaces.md)     |
| 69  | Setup writes `merge`; `pnpm merge <N>` runs from the default-branch checkout          | [0017](0017-running-and-merging-workspaces.md)     |
| 70  | The gate re-runs its starter in three launcher forms: JS entry, executable, refuse    | [0017](0017-running-and-merging-workspaces.md)     |
| 71  | Phase 6 keeps `pnpm-workspace.yaml` whole (decision 66); #285 closes with decision 64 | [0017](0017-running-and-merging-workspaces.md)     |
| 72  | Phase 6: one builder; its packed judge tests are written apart and integrated         | [0017](0017-running-and-merging-workspaces.md)     |
| 73  | Phases 6 and 7 build at the same time in separate worktrees and land in order         | [0017](0017-running-and-merging-workspaces.md)     |
| 74  | temple-bar generates no knip config; the gate attributes knip's findings per package  | [0017](0017-running-and-merging-workspaces.md)     |
| 75  | Real-install tests form a release tier: run by hand, required before a release stages | [0017](0017-running-and-merging-workspaces.md)     |
| 76  | At the 0.1.0 pin each package checks its own files; root `test` runs scripts/, e2e/   | [0017](0017-running-and-merging-workspaces.md)     |
| 77  | A test fails if a tracked test file is run by no test script, or by more than one     | [0017](0017-running-and-merging-workspaces.md)     |
| 78  | The standalone CI job runs `pnpm gate` once the pin can start standalone pnpm         | [0017](0017-running-and-merging-workspaces.md)     |
| 79  | This repo merges with `pnpm merge <N>`; the baseline refresh lands before the pin     | [0017](0017-running-and-merging-workspaces.md)     |
| 80  | Merge keeps the merged branch's worktree and local branch, and reports them           | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 81  | One GitHub reference per line; in a pull request, nested under its change bullet      | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 82  | `ready` fetches the default branch first, refuses a behind branch and fails closed    | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 83  | The gate requires the AGENTS.md block in every repo set up with temple-bar            | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 84  | Agents create worktrees only through their harness, never with `git worktree add`     | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 85  | An oversized pull request needs `One concern:`; source and test lines count apart     | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 86  | A pull request the judge refuses: description is the squash body, checklist a comment | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 87  | A pin bump's mixing is disclosed by the judge's refusal, not yet refused              | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 88  | The gate checks every tracked file is type-checked and tested, as the gate runs them  | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 89  | Every decision lives in an ADR; the decisions list became this index                  | [0016](0016-agent-rules-and-the-merge-loop.md)     |
| 90  | Setup reads git's index once per write batch, which holds no prompt or index write    | [0018](0018-one-index-read-per-batch.md)           |
