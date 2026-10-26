# ADR 0018: Setup reads git's index once per batch of writes

Date: 2026-10-26. Status: proposed (decision 90; the batch rule was approved
with the [0.3.0 plan](../plans/0.3.0.md) on 2026-10-25, for
[#454](https://github.com/londontypescript/temple-bar/issues/454)).

## Context

Setup never writes through a symlink
([#300](https://github.com/londontypescript/temple-bar/pull/300)). Before
every read, write and chmod, `WriteTargets` (`init/write-target.ts`)
classifies the target and every folder on the way to it without following
links, and asks git's index about the same paths
(`git ls-files -s -z -- <setup's paths>`), so that a link git checked out as an
ordinary file (on Windows with `core.symlinks=false`) still counts as a link.
That fix cached nothing: the index was read again immediately before each
operation.

The cost is git's start-up time. One setup run read the index 34 times, out
of 44 git calls. A git process costs 17 to 45 ms on the Windows CI runner and
about 2 ms on Linux, so setup costs a Windows user about a second, and the
write-target integration test, which runs setup many times, made about 1886
index reads and took about 104 s on Windows against 15 s on Linux.

Three ways to read less were weighed: once per run or per `WriteTargets`
object, again only when the index file's stat changes, or once per explicit
batch of writes.

## Decision

**Decision 90: setup reads git's index once per explicit batch of writes,
and afresh everywhere else.**

- `WriteTargets.batch(work)` runs `work` with a view of the same targets.
  Inspections through the view share one index read: the first reads it,
  later ones reuse it. The object the view came from never keeps a read: an
  inspection on it while a batch is running, and every other batch, reads
  the index for itself.
- The view shares that object's refusals and their reporting, so each
  refusal is recorded and reported once, whichever of them found it.
- When `work` settles, normally or by throwing, the read is dropped and the
  view throws on any further use. An operation still running when its batch
  ended fails before it touches the disk, rather than act on the batch's
  read.
- A failed read is not kept: the next inspection reads again.
- The disk is never cached, inside a batch or out: every operation
  classifies its target and folders again just before it acts.
- The hooks' targets read no index, so a batch on them changes nothing.
- `writeSetupFiles` runs as one batch. The early `.gitignore` step in
  `init/command.ts`, before the GitHub questions, stays outside it and reads
  afresh. One setup run on a fresh repo now reads the index 3 times (twice
  for that early step, once for the batch), down from 34.

**Why #300's guarantee holds.** A batch holds no prompt and no git command
that writes the index. Setup's questions are asked before `writeSetupFiles`
starts, and its index writers (`git add -A` and the first commit, in
`init/github-repo.ts`) run after it returns. Every batch starts with a fresh
read, so nothing is carried across a question or a commit. A test runs the
whole batch over four kinds of repo (fresh with no `package.json`, no
`origin`, already set up, and set up by an earlier release) and fails on any
prompt, on any git call outside a short list of read-only shapes, and on more
than one index read.

**What it gives up.** Before, the index was read immediately before each
write. Inside a batch it is read once, up to a second or so before the
batch's last write. Another process that stages a link (mode `120000`) for a
setup path during that time, leaving an ordinary file on disk, is no longer
caught. This wider index window is accepted: setup is a local command run by
its owner, and a link on disk is still caught at every write. #300's
guarantee now reads: setup refuses a link that is on disk when it inspects
the target just before the write, or staged in git's index when the batch's
first inspection read it (outside a batch, when that inspection read it).

The check-to-write caveat is unchanged, and it is a different, narrower
window: a process that replaces an inspected entry with a link between the
inspection and the write can still win, as before, since Node has no
portable no-follow write. That window is the moment between one inspection
and its write; the index window spans the whole batch.

**A batch inside a batch is refused.** Starting a batch from a view throws.
Reusing the outer read would let a nested batch look as if it started fresh
when it didn't; refusing keeps "every batch starts with its own read"
literally true. Code that already holds a view can pass it on instead.

**Inspections racing through one view share the read in flight.** The read
is kept on the batch as a promise, so a batch makes one successful read
however its inspections interleave, and the count the test checks doesn't
depend on timing. Sharing costs no freshness: every inspection that shares
it started inside the batch. A failed read fails each inspection waiting on
it and is then forgotten.

Rejected:

- _Reading once per run, or once per `WriteTargets` object._ Safe today only
  through call order. In `init/command.ts` the same object lives across the
  GitHub questions and calls (`resolveOrigin` may write setup's files between
  questions, before the first commit), so a later change to that order would
  classify from a stale index.
- _Reading again when the index file's stat changes._ Git replaces its index
  by renaming a lock file over it, so a new index can arrive with a reused
  inode and the same size and timestamp; reading the index and checking its
  stat can't be done as one step; a fresh repo has no index file; and the
  usual guard against coarse timestamps (treating a change within two
  seconds as unknown) would make most runs read again anyway.

## What would end it

- Setup needing to ask a question or change the index in the middle of its
  writes: the batch would split there, each part starting with its own read.
- A cheap way to read git's index without starting a process, or a portable
  no-follow write in Node, either of which would remove the cost or the
  window this trades on.
- Evidence that something other than a repo's owner stages links in it while
  setup runs.
