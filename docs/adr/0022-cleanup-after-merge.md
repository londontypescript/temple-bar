# ADR 0022: Cleanup after merge

Date: 2026-11-01. Status: accepted (decision 101, for 0.3.0;
[#479](https://github.com/londontypescript/temple-bar/issues/479)).

## Context

[ADR 0016](0016-agent-rules-and-the-merge-loop.md)'s decision 80 made
`temple-bar merge` keep the merged branch's worktree and local branch, after
merge's clean-up deleted the folder an agent's session lived in
([#391](https://github.com/londontypescript/temple-bar/issues/391)). Removal
was left to the harness that made the worktree and to `temple-bar leftovers`,
which only reports.

That ADR named what would end the decision: harnesses and `leftovers` not
cleaning up, and kept worktrees piling up. Both happened. Harnesses leave
their worktrees behind, admin merges skip `merge` and so leave the remote
branch too, and on 2026-10-28 the maintainer approved removing three merged
worktrees, their branches and a stray remote branch here, and seven merged
remote branches in grand-union, by hand.

The question decision 80 left open is how to tell a worktree a session still
lives in from one nobody uses. Nothing git records can tell: a session may be
reading in a folder without changing anything. Only the session knows when it
is done.

## Decision

**Decision 101: an explicit `leftovers --remove` removes what a merged pull
request left behind, and only worktrees their session has released.**

- `merge` deletes nothing more than before: decision 80 stands. Its report
  names `temple-bar leftovers --remove`.
- **Release.** `temple-bar leftovers --release` is the owning session's last
  step, after its handoff. Releasing says everything worth keeping is on
  GitHub, so every ignored file in the worktree, `.temple-bar/` included,
  becomes disposable. It records, in a per-worktree git ref
  (`refs/worktree/temple-bar/released`), the branch, HEAD, and the path and
  checksum (never the contents) of every ignored file outside
  `node_modules` and build output, and lists those files to the session.
  `--unrelease` withdraws it; a session that resumes in a worktree runs it
  first.
- **Valid only while unchanged.** The marker holds only while the worktree
  has the same branch, exactly the same HEAD and the same files. A resumed
  session that commits, edits or writes a note invalidates it without having
  to remember to. Dependencies and build output (`node_modules`, `dist`,
  `coverage`) and empty folders aren't watched: they are disposable whenever
  written. The one exception is merge's own commit: when `merge`
  brings a released worktree up to date and pushes, it moves the marker to
  the new HEAD, because only merge knows that commit is its own.
- **A claim, not a check.** `--remove` claims a worktree by turning
  `released` into `removing` in one git ref transaction, so a racing
  `--unrelease` and `--remove` can't both succeed. A session whose
  `--unrelease` loses is told the worktree is being removed, before it works
  there.
- **What may go.** A worktree goes only when its branch's newest pull request
  merged into the default branch from this repository and the branch holds
  nothing beyond it; the marker is valid; and the worktree is this
  repository's, not locked, with no staged or unstaged change, no hidden
  index flags, no gitlink, no operation in progress, no untracked file, no
  nested repository or worktree and no mounted folder anywhere in it, and
  neither the command's own folder nor `INIT_CWD` nor `PWD` inside it.
  Links and `gitdir` targets are never followed. It runs only when git and gh point at one
  repository, with origin's fetch and push URLs naming it. Anything it can't
  inspect keeps the worktree, reported with the reason.
- **No `--force`.** git's own refusals (locked worktrees, submodules,
  untracked or modified files at deletion time) stay in force under every
  check temple-bar adds.
- **Branches.** A local branch goes only once no worktree holds it, with
  git's old-value check as a lease and never through a symbolic ref. A remote
  branch goes only while its tip is exactly the merged head, with merge's
  existing lease. A closed, unmerged pull request's branch is reported, never
  removed. Admin merges are covered the same way, since nothing here depends
  on `merge` having run.
- Agents find the command through one line in the installed
  `docs/pull-requests.md`, naming `pnpm exec temple-bar leftovers --remove`
  as the step after `pnpm merge`. Setup adds no script for it.
- `temple-bar leftovers` with no flag reports the same verdicts and deletes
  nothing. The main checkout is never a candidate, so its `.temple-bar/` is
  never touched.

## Consequences

- A merged phase can leave nothing behind, with one command run from the main
  checkout, on the session's word rather than a guess.
- A session that forgets to release leaves its worktree, reported with the
  reason; that fails safe.
- A session that resumes in a released worktree without running
  `--unrelease`, and only reads, can lose its folder. It loses no work: the
  marker certified everything there is on GitHub or not needed. Nothing short
  of watching processes could see a session that leaves no trace, and that
  isn't portable.
- What can still slip between the last check and the deletion: an ignored
  file written in that moment (git refuses an untracked or modified one
  itself), and a checkout of the branch just before its local deletion (the
  tip is the merged head, which GitHub keeps, so nothing is lost).
- Ignored local data (notes, caches, local settings, `.env` files) goes with
  the worktree. The release lists it and the delegation guide says so
  plainly; a session that needs any of it keeps it elsewhere first.
- Recovery history inside the worktree's git directory (its HEAD reflog) is
  disposable once released. A mounted folder is found by its device number,
  a Windows volume mount point included. On Windows any junction or
  directory link keeps the worktree, because Git for Windows walks into
  them: in 0.3.0's CI it listed files through a junction leading outside
  the worktree, and `git worktree remove` on a worktree holding a junction
  exited 0 and dropped its record but left the folder. `git clean` had the
  same fault until Git for Windows fixed it
  ([git-for-windows/git#5320](https://github.com/git-for-windows/git/issues/5320));
  worktree removal has no such fix. A pnpm worktree on Windows, where pnpm
  links every package with a junction, is therefore kept until its
  node_modules is gone. One mount can't be seen: a bind mount of a folder
  on the same device.
- On git older than 2.36, which can't list a worktree path containing a
  newline unambiguously, such a worktree stops the command rather than being
  guessed at.
- Delegation guidance gains two lines: release last, unrelease first.

## Rejected

- _Merge removes the worktree when it is safe._ It can't tell a live session
  from an idle one (the #391 incident).
- _Infer idleness (no recent writes, no process with its folder there)._
  Reading leaves no trace, and process inspection differs on every platform.
- _A marker file in the worktree or its git directory._ A file can be
  committed, copied or written through a symlink, and two writers race; a
  per-worktree ref is private, goes with the worktree, and changes atomically.
- _Let the marker survive any HEAD that reaches the merged head._ A resumed
  session's own pushed commit would pass; only merge's commit is carried.
- _Remove locked worktrees, or force at all._ A lock is another tool's claim;
  force overrides git's last checks.
- _`git branch -D` and a plain remote delete._ Neither checks that the branch
  is still where it was read.
- _A fixed list of disposable ignored files_ (`.temple-bar/`,
  `node_modules`, build output, a `.env` identical to the main checkout's).
  Harnesses copy their own ignored files into every worktree, so the list
  kept nearly every worktree; releasing is already the session's statement
  that nothing local is needed.
- _A `leftovers` script in every project setup writes,_ beside `gate`,
  `ready` and `merge`. One guide line finds it as well, without more setup.
- _Remove detached and prunable worktrees too._ Neither is what a merged pull
  request leaves; both stay reported.

## What would end it

- If harnesses come to release or remove their own worktrees reliably, the
  marker becomes redundant there, though harmless.
- If sessions often lose their folder because they resumed without
  `--unrelease`, the release needs a stronger signal than guidance.
