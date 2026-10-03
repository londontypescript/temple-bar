# ADR 0012: Push once, with `temple-bar ready`

Date: 2026-10-03. Status: accepted (decision 35;
[#65](https://github.com/londontypescript/temple-bar/issues/65), incident
[#160](https://github.com/londontypescript/temple-bar/issues/160)). Builds
the mechanism [ADR 0003](0003-how-a-change-reaches-main.md) planned.

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

**Changes that need the user's yes** are the ones `temple-bar merge` already
holds back: any `AGENTS.md`, and a change to the pinned
`@londontypescript/temple-bar` in the root `package.json`, compared with
`origin/<default branch>`. `ready` reuses merge's detection rather than
keeping a second list. For those, `ready` asks in the terminal and marks the
commit only on a typed yes. With no terminal it stops before running the
gate and says to ask the user to run `ready` themselves, in a terminal.

### Known limits

These are stated here and in [docs/enforcement.md](../enforcement.md), never
in a message an agent reads at the moment of a refusal.

- **`git push --no-verify` skips `pre-push`.** git's hook-skipping flag
  skips the hook, and nothing local can stop that. The cost stays bounded: CI and the ruleset are the final
  barrier, so a skipped hook costs a red CI run, never a broken `main`.
- **The confirmation proves a terminal, not a person.** A cloud agent with no
  terminal can't give the user's yes at all, and has no other way to get it
  yet: it must ask the user to run `ready` on a machine with the branch. An
  agent that can drive a pseudo-terminal could type the answer itself. Until
  a confirmation channel the agent can't reach exists, the yes typed into
  `ready` is a speed bump that makes the agent stop and ask, not a proof.

## What would end it

This is wrong if CI becomes cheap enough that pushing often costs nothing,
which removes the reason for pushing once. The confirmation step should be
replaced once there is a channel an agent can't answer for the user, such as
an approval on GitHub that only the maintainer can give.
