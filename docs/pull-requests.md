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
- **A `One concern:` line** when the pull request closes two or more
  issues or is over the size limits, giving a reason that counts. The
  reasons that count are in [the rationale](agents-rationale.md).

## Pushing and merging

- Every push runs the full CI, so push once, when the work is final.
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
admin, check":

- the judge's refusal names only what's expected;
- every other check is green;
- GitHub's merge preview shows the right subject, body, and co-author and
  reviewer trailers;
- a `One concern:` line when the pull request closes several issues or is
  over the size limits, because an admin merge skips merge's own
  enforcement;
- anything specific to the change. For a pin bump: the lockfile's integrity
  hash matches the one npm publishes, and the `package.json` and lockfile
  diffs, read in full rather than as a list of files, hold nothing
  unrelated.

Setup doesn't set GitHub's squash-message default, so a repository's default
may differ: the merge preview is where a wrong message is caught.
