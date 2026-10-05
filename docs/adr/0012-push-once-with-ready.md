# ADR 0012: Push once, with `temple-bar ready`

Date: 2026-10-03. Status: accepted (decision 35;
[#65](https://github.com/londontypescript/temple-bar/issues/65), incident
[#160](https://github.com/londontypescript/temple-bar/issues/160)). Builds
the mechanism [ADR 0003](0003-how-a-change-reaches-main.md) planned.
Amended 2026-10-05
([#237](https://github.com/londontypescript/temple-bar/issues/237)): the
yes typed in a terminal became a warning, and merge records the approval
in the squash message.

## Context

Every push to a pull request runs the full CI, so decision 35 says a branch
is pushed once, when its work is finished. That rule was prose only, and
incident #160 showed what prose costs: an agent ran the gate through a pipe
that hid its exit code, pushed a failing branch, and burned a CI run. The
only thing between a failing gate and a push was the agent's own care.

The options weighed in #160: run the full gate in `pre-push` (deterministic,
but 30 to 60 seconds on every push); run a fast subset (misses tests); a
harness-specific hook (not harness-neutral); leave it to CI (as before); or
a separate command that marks a commit which passed, with `pre-push`
refusing anything unmarked. The last one was chosen: deterministic, an
instant push, and it enforces push-once as well as the gate.

## Decision

**`temple-bar ready`** runs the full gate on the commit checked out in the
current worktree and, only if it passes, marks that commit ready to push.
Before the gate runs, the worktree must match its commit exactly: no
uncommitted changes and no untracked files (ignored files such as
`node_modules` don't count). The gate reads files on disk, but a push
carries only the commit, so a forgotten `git add` would otherwise pass here
and fail in CI. If the commit changes while the gate runs, nothing is
marked. Every run first clears the old mark, so a failed run never leaves an
earlier one behind.

**The `pre-push` hook** refuses a branch whose tip is not the marked commit.
Its message says to run `ready` in the worktree that has the branch checked
out. Branch deletions and tags are left alone, as before, and so are pushes
to the default branch, which the ruleset and the `reference-transaction`
hook already refuse.

**Where the mark lives:** a one-line file holding the commit's hash, at
`git rev-parse --git-path temple-bar-ready`. That is `.git/temple-bar-ready`
in the main checkout and `.git/worktrees/<name>/temple-bar-ready` in a linked
worktree. It survives between `ready` and `git push`, which are separate
processes. Each worktree has its own, so a commit marked in one never lets an
unchecked commit out of another. Nothing in git's folder is ever committed or
shows as a change. Any new commit clears the mark without anyone deleting it:
the hook compares the marked hash with the commit being pushed, and a new
commit has a new hash.

**Changes that need the maintainer's yes** are the ones `temple-bar merge`
already holds back: any `AGENTS.md`, and a change to the checks that judge
the repository (the files the judge guards, including the pinned
`@londontypescript/temple-bar` in the root `package.json`), compared with
where the branch left `origin/<default branch>`. `ready` and the `pre-push`
hook reuse merge's detection rather than keeping a second list. For those,
both **warn**: the change needs the maintainer's yes, so ask the maintainer
in chat and push only once they say yes. Neither asks anything in the
terminal, and neither blocks: `ready` still marks the commit, and the hook
still lets it out.

**`temple-bar merge`** keeps `--maintainer-approved` as the agent's own
claim that the maintainer said yes in chat. Without it, a change to
AGENTS.md is refused with the same instruction to ask the maintainer
first. A change to the checks is refused whatever the flag says, as
[ADR 0011](0011-which-checks-judge-a-pull-request.md) decides. Merge's
"what you are approving" summary lists each change that needs the
maintainer's yes (for example "changes AGENTS.md"), so the maintainer
sees what they are agreeing to. The squash commit carries a
`Maintainer-Approved: changes AGENTS.md` line next to its co-authors, so
the claim is in `git log` on the default branch.

**Why a warning, not a typed yes.** Until 2026-10-05, `ready` asked for a
yes typed in a terminal and marked the commit only on that yes. It proved a
terminal, not a person: an agent can drive a pseudo-terminal and type the
answer, and a cloud agent with no terminal couldn't go on at all. A speed
bump that an agent can drive over, and that stops a cloud agent dead, cost
more than the warning that replaces it. The warning tells the agent the one
thing it must do, ask in chat; the trailer makes a skipped request visible
afterwards.

### Known limits

These are stated here and in [docs/enforcement.md](../enforcement.md), never
in a message an agent reads at the moment of a refusal.

- **`git push --no-verify` skips `pre-push`.** git's hook-skipping flag
  skips the hook, and nothing local can stop that. The cost stays bounded: CI and the ruleset are the final
  barrier, so a skipped hook costs a red CI run, never a broken `main`.
- **The maintainer's yes is detected, not prevented.** The warnings don't
  stop a push, and `--maintainer-approved` is a flag the agent passes
  itself: nothing checks that the maintainer said yes. Agents work under
  the maintainer's own GitHub account, so GitHub can't tell their merge
  from the maintainer's either. What is left is visibility: the summary
  shows the maintainer what they are agreeing to, and the
  `Maintainer-Approved:` line shows in `git log` which merges claimed a
  yes. A commit on the default branch that changes AGENTS.md without that
  line was merged some other way (`gh pr merge`, the web page), skipping
  the request; a claim that was false looks the same as a true one.
  Real enforcement needs agents to have their own GitHub identity
  ([#145](https://github.com/londontypescript/temple-bar/issues/145)):
  then a code-owner review on AGENTS.md is enforced by GitHub itself.

## What would end it

This is wrong if CI becomes cheap enough that pushing often costs nothing,
which removes the reason for pushing once. The warning and the recorded
claim should be replaced once there is a channel an agent can't answer for
the maintainer, such as a code-owner review on GitHub that only the
maintainer's own identity can give (#145).
