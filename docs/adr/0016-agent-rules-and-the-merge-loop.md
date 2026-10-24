# ADR 0016: Agent rules and the merge loop, frozen for grand-union

Date: 2026-10-24. Status: accepted (plan decisions 80 to 89 for 0.2.0;
[#397](https://github.com/londontypescript/temple-bar/issues/397)).

## Context

grand-union, the London TypeScript org's monorepo, adopts temple-bar in place
once 0.2.0 ships (decision 28, [ADR 0002](0002-what-temple-bar-is-for.md)).
0.2.0's scope was frozen on 2026-10-24 to what grand-union would meet in its
first weeks: the rules agents keep missing, the merge loop's waste and
accidents, and a gate that can say whether every file is checked. The
[0.2.0 plan](../plans/0.2.0.md) lays out the phases.

Each open question in the milestone was settled in one decide-first pass that
day, so no brief would have to decide it mid-build. Every decision was reviewed
adversarially by ChatGPT Sol 6.1 before it came to the maintainer, who approved
them one at a time. The full record of each, with the reviewer's amendments, is
a comment on its issue; this ADR holds the rule, the reason and what was
rejected, so that briefs and later readers need not reconstruct it.

Decisions 80 to 87 came from incidents on this repo and on tate-modern, the
testbed that has run published temple-bar since 2026-10-12. Decision 88 is the
check grand-union needs most. Decision 89 finishes a move begun by decision 57
([ADR 0010](0010-plans-progress-and-incidents.md)): the ADRs become the only
home of a decision.

## Decisions

**Decision 80: merge keeps the merged branch's worktree.**
`temple-bar merge` still merges, deletes the remote branch and fast-forwards
the default branch, but it leaves the branch's worktree and local branch in
place and its report says where they are. Removing them is left to whatever
made the worktree (an agent harness cleans up its own) and to
`temple-bar leftovers`, which already lists them. The incident
([#391](https://github.com/londontypescript/temple-bar/issues/391)): an agent
ran merge from inside the branch's own worktree, and merge's clean-up deleted
the folder the agent's session lived in.

Rejected:

- _Refuse unless merge runs from the main checkout._ It doesn't fix the
  incident: `pnpm -C <main checkout> merge <N>` changes only the command's
  folder, the session still lives in the branch's worktree, and clean-up would
  still delete it. It would also block the first merge on a newly adopting
  repository, whose default branch has no merge script yet, and it adds no
  protection against a branch's own `merge` script, which pnpm runs before
  temple-bar can check anything. AGENTS.md's rule to merge from the main
  checkout stays prose.
- _A `--keep-worktree` flag._ An agent that forgets it loses its session again.

**Decision 81: one GitHub reference per line.** In anything posted to GitHub,
each issue or pull request reference sits on its own line. In a pull request
description, each reference goes on its own nested line under the change
bullet it belongs to, for example `  - Closes #N`, on one physical line; a
description with no bullets puts its closing reference on a standalone line.
Merge is unchanged: it already keeps only top-level bullets, so the squash
message carries the change text without the bare reference, and GitHub
honours a closing keyword wherever it appears. "One physical line" matters
because a wrapped line under a nested item is joined onto its parent bullet.
([#383](https://github.com/londontypescript/temple-bar/issues/383))

Rejected: a separate `Closes:` list that merge strips, which would need a merge
change for no gain, and a warning on several references per line, which can
follow if the rule is seen to drift.

**Decision 82: `ready` fetches the default branch first and fails closed.**
Before the gate runs, `ready` fetches the default branch alone (no tags or
other branches) into its remote-tracking ref, through the git seam, counts how
many commits the branch is behind it, and refuses when that count is above
zero, saying how to merge it in. If the fetch fails, `ready` stops and says
why, as it already does when there is no comparison ref: warning and carrying
on would allow the wasted CI run this exists to prevent. Only `ready` fetches.
`pre-push` reuses part of `ready`'s logic, so the fetch and the count stay
outside it, and pushes make no extra network call. When merge catches a branch
up it already runs the gate and marks the new commit itself. The default
branch is resolved the same way everywhere, since a fetch doesn't set
`origin/HEAD` and local detection falls back to `main`.
([#262](https://github.com/londontypescript/temple-bar/issues/262))

**Decision 83: the gate requires the AGENTS.md block.** Once this repo's own
AGENTS.md has the block, the gate fails any repo set up with temple-bar whose
AGENTS.md is missing or has no temple-bar block, like a missing hook shim or
`.gitignore` line, with the fix "run setup again". No exemption for older
repos: nothing outside the org uses temple-bar. Until now the block was checked
only when its markers were present, so deleting the markers and pasting an
edited copy passed. The order of work: this repo gets the block from the
pinned 0.1.0 setup first; the stricter check ships in 0.2.0; the pull request
that pins 0.2.0 reruns setup to write 0.2.0's block, since the gate requires
the current text, not just the markers. Setup records the replaced block's
hash, or it would refuse to upgrade the old block as a manual edit.
([#258](https://github.com/londontypescript/temple-bar/issues/258))

**Decision 84: agents create worktrees only through their harness.** The
AGENTS.md template says: have your harness create each branch's worktree,
prepare it there before handing it over, never choose a worktree location or
run `git worktree add` yourself, and if the harness can't create the worktree
you need, say so and ask the user how to proceed, once per session. The
incident was an agent choosing a location of its own. No exception is stated
for raw `git worktree add`, because an exception would let agents choose a
location again. "Once per session" means the user's answer covers the rest of
that session, so a harness limit isn't raised for every branch.
([#392](https://github.com/londontypescript/temple-bar/issues/392))

Left out: a `post-checkout` warning, and the worktrees that ChatGPT's
implementation runs need outside the repo, both in 0.6.0.

**Decision 85: an oversized pull request needs a `One concern:` line,** as one
closing two or more issues does, and merge refuses without it. The size must
be measured successfully: a failed measurement refuses, where it was ignored
as advice. The check runs before merge waits for the checks. Source and test
lines are counted apart: the existing line limit, 500 by default, applies to
non-test lines; test lines get their own, higher limit, 1,000 by default, set
in `temple-bar.config.json`; the file limit, 15, stays combined. A test is
recognised by name: `*.test.*`, `*.spec.*`, anything under `__tests__/`, and
`*.snap`. `fixtures/` counts as source, so code can't escape the limit there.
The existing exclusions stay: lockfiles, pure renames and files marked
`linguist-generated`. A short list of reasons that count for size, beside the
several-issues list, goes in `docs/agents-rationale.md` and the companion docs
setup ships: a mechanical change across many files, or a refactor that can't
land half-done; not "it's all one feature".
([#393](https://github.com/londontypescript/temple-bar/issues/393))

The same phase fixes the size report's false warning
([#382](https://github.com/londontypescript/temple-bar/issues/382)): at merge
it reuses merge's own validation of the `One concern:` line, on the same
snapshot of the description, and drops the "closes N issues" problem when the
line is valid. At `pre-push`, where no pull request exists yet, a general
reminder stays. A warning that's wrong teaches readers to skip warnings.

**Decision 86: a pull request the judge will refuse carries the squash body.**
For a pull request the judge will refuse, and the maintainer therefore merges
as admin on GitHub, the AGENTS.md template says: the description is exactly
the squash commit's body, one bullet per change (none when the title says it
all), then the co-author lines, with no "Generated with" line and no note to
the maintainer; the title supplies the subject. What the maintainer should
check goes in a separate comment headed "Before merging as admin, check": the
judge's refusal names only what's expected; every other check is green;
GitHub's merge preview shows the right subject, body and co-author trailers; a
`One concern:` line when the pull request closes several issues or is over the
size limits, because an admin merge skips merge's own enforcement; and
anything specific to the change, such as a pin bump's lockfile integrity hash
matching the one npm publishes. Setup doesn't set GitHub's squash-message
default, so the template doesn't promise it in every adopting repo; the
preview item covers it.
([#270](https://github.com/londontypescript/temple-bar/issues/270))

**Decision 87: a pin bump's mixing is disclosed, not yet refused.** AGENTS.md
says a pin bump is its own pull request, never a side effect of other work.
`temple-bar merge` can't enforce that: the judge already refuses any change to
the pinned version, so every pin bump is admin-merged on the website and a
refusal in merge would never fire. Instead, when the pinned version moves, the
judge's refusal lists every other path the pull request changes, still
compared at the fixed commits, and the decision 86 checklist gains a pin-bump
item: read the `package.json` and lockfile diffs, not just the file list,
because unrelated edits can hide inside them. The mechanical refusal, which
has to compare what changed with what that version's setup would write, is
deferred to [#426](https://github.com/londontypescript/temple-bar/issues/426).
([#234](https://github.com/londontypescript/temple-bar/issues/234))

**Decision 88: the gate checks that every tracked file is type-checked and
tested.** The check is bound to what the gate actually runs, not to
`tsconfig.json`. For each checked package, and the root, it works out which
files that package's real `typecheck` script covers, supporting the common
forms (`tsc -p <config>`, and `tsc -b` with project references) and failing,
naming the supported forms, when a script's form isn't one it understands; it
never falls back to another config, and leaves declaration files out. For
tests it takes the union of every test run the gate makes and compares it with
every runnable test file in the repository, so a root Vitest run and
per-package runs both count; missing files are named and attributed to their
deepest owning package, and root files outside any package count too. Runnable
tests are `*.test.*` and `*.spec.*` code files, a definition separate from the
size check's. Exclusions live only in `temple-bar.config.json`, which the judge
already guards, so adding one needs the maintainer. A failed listing is a
failure, not a skip. Stated limit: a compiler's file list proves a file is
included, not that checking is strict. The gate's added time is measured, and
identical invocations are deduplicated. This repo keeps its own stricter check
of test selection. A probe of TypeScript's and Vitest's listing commands comes
before the brief is final.
([#394](https://github.com/londontypescript/temple-bar/issues/394))

**Decision 89: every decision lives in an ADR.** The decisions list in
`docs/plans/temple-bar.md` becomes an index in `docs/adr/`: number, one line,
link to the ADR, with the numbering kept so "decision 28" still resolves.
Every decision gets an ADR as its home: decision 54 joins
[ADR 0003](0003-how-a-change-reaches-main.md), decision 55 joins ADR 0010,
decisions 68 to 79 from the 0.1.0 plan go into one new ADR for 0.1.0's running
and merging of workspaces (moving approved text, deciding nothing new; the
0.1.0 plan stays as history), and the 0.2.0 decisions are recorded here with
the plan, not as rows in the old list. The plan's other sections retire to
git history, issues or ADRs. Every link to the old path is updated; no script
or check reads it mechanically, and the gate's link check catches a dangling
one. ([#259](https://github.com/londontypescript/temple-bar/issues/259))

## Left to the agent, within bounds

One question was not decided but bounded
([#303](https://github.com/londontypescript/temple-bar/issues/303)): which of
a check's runs is newest when one was cancelled while queued and replaced.
The agent probes real GitHub first, on a throwaway repository, then orders a
check's runs by the workflow run they belong to, then by attempt, with the
check-run ID only as a tie-breaker, unless the probe shows something else is
needed. A higher check-run ID alone means the check was created later, not
that it belongs to a newer workflow run. Checks from different workflows stay
independent. The findings are recorded on the issue, and the maintainer is
asked only if GitHub's records can't tell which run is newer.

## Consequences

- grand-union adopts a temple-bar whose AGENTS.md template carries decisions
  81, 84 and 86, whose merge never deletes the folder an agent works in, and
  whose gate can say which files nothing checks.
- Two new refusals land in the loop (decisions 82 and 85), each stopping a
  wasted run or an unexplained oversized merge; each ships with break-it
  evidence.
- The decisions list, kept since 2026-09-28, stops growing; this ADR is the
  first written in its place.

## What would end it

- Decision 80, if `temple-bar leftovers` and the harnesses prove not to clean
  up, and kept worktrees pile up: then merge would need a safe way to tell a
  worktree a session lives in from one nobody uses.
- Decision 87, when [#426](https://github.com/londontypescript/temple-bar/issues/426)
  builds the mechanical refusal.
- Decision 88, if the gate's added time proves too high on grand-union's
  stack; the measurement is part of the phase.
