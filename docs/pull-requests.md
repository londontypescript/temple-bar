# Pull requests

How AGENTS.md's pull request rules work in practice. Read it before opening
a pull request. temple-bar's setup wrote this file.

## Title and description

- **The title** (and every commit message) takes a conventional prefix
  (`feat`, `fix`, `docs` or `chore`), is proportional to the change, and
  names the change, never the trigger ("address feedback").
- **One bullet per distinct change,** as a top-level list: merge turns the
  title and those bullets into the squash commit.
- **Each issue or pull request reference** goes on its own nested line
  under the change bullet it belongs to, for example `  - Closes #N`, on
  one physical line: a wrapped nested line is joined onto its parent
  bullet. A description with no bullets puts its closing reference on a
  line of its own.
- **The milestone** is the one the closed issue is in
  (`gh pr create --milestone <name>`), so the pull request's page shows
  which release it belongs to. It mirrors the issue, never adds scope.
- **A `One concern:` line** when the pull request closes two or more
  issues or is over the size limits, giving a reason that counts. The
  reasons that count are in [the rationale](agents-rationale.md).

## Pushing and merging

- Every push runs the full CI, so push once, when the work is final.
- **A reviewer is recorded on a commit.** When someone other than the
  author reviewed the change, add `Reviewed-by: <reviewer>` as a trailer
  to the branch's last commit before its one push. `pnpm merge` copies
  each one from the branch's commits into the squash message; a line in the
  description doesn't count.
- `pnpm merge <N>` runs whatever the current folder's `package.json` says.
  Inside a pull request's worktree that is the pull request's own scripts,
  so run it from the default-branch checkout.

## Merging as admin

The judge refuses a pull request that changes the checks it guards, so
`temple-bar merge` can't land it: the user merges it as admin on GitHub. Any
other refusal is a failure to diagnose, never a reason to ask for a bypass.

A bump of the pinned temple-bar is one of these, and goes in a pull request
of its own, never mixed with other work.

**The description is exactly the squash commit's body:** one bullet per
change (none when the title says it all), then the co-author and reviewer
lines. No "Generated with" line, and no note to the user. The title supplies
the subject.

**What to check goes in a separate comment,** headed "Before merging as
admin, check". It holds only what the user verifies before merging:

- the judge's refusal names only what's expected;
- every other check is green;
- GitHub's merge preview shows the right subject, body, and co-author and
  reviewer trailers;
- a `One concern:` line when the pull request closes several issues or is
  over the size limits, because an admin merge skips merge's own
  enforcement;
- the branch is up to date with the default branch, which you check before
  handing over, because an admin merge doesn't update it as merge does.

A change may add checks of its own after these five, never results. A pin
bump adds two: the lockfile's integrity hash matches the one npm publishes,
and the `package.json` and lockfile diffs, read in full, hold nothing
unrelated.

**Evidence goes in its own comment** (break-it results, manual runs, review
summaries), never in the checklist, so the checklist stays short.

**With several pull requests in flight,** merge the admin one first, or
update it and let CI rerun before asking for the admin merge: each other
merge can leave it behind.

Setup doesn't set GitHub's squash-message default, so a repository's default
may differ: the merge preview is where a wrong message is caught.
