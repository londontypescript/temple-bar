// The guides AGENTS.md links to: how its rules work in practice, each read
// at the moment the block names (before planning, before work stops, before
// opening a pull request, before delegating, when something goes wrong).
// The block keeps each rule to a line or two; the procedure behind it lives
// here, so AGENTS.md stays within the size every agent loads in full. Setup
// writes each where the project has none (see companion-docs.ts).

/** What a phase boundary is, what to write before work stops, and how to
 * resume. */
export const PHASE_BOUNDARIES = `# Phase boundaries

AGENTS.md says to clear or compact a session only at a phase boundary, and
to write the state on the issue before work stops. This guide says what
that means in practice, for any tool.

## What a phase boundary is

A point where nothing is half done:

- every change is committed, and the checks pass on the last commit;
- the issue says what was finished, with the commits or pull request;
- nothing is waiting on a subagent, a CI run or an answer from the user.

The end of a phase in the plan is the usual one. A finished subtask, with
its commit made and the issue updated, is a smaller one.

## What to write down

Before work stops (a compact, a pause, a usage limit, a change of tool;
judge it from what the user says), update the issue with:

- the base commit (SHA) and the branch;
- the exact command that reproduces the problem or proves the work is done;
- what has been ruled out, with the reason for each;
- the next action.

Leave out private details: credentials, local paths, internal hostnames.
Show the user the exact text and post it after their yes: this update
only, not routine ones.

Notes kept by one tool (its memory, its own task list) don't count: the
next session may run in another tool. The issue and git are what every tool
and person can read.

## How to resume

1. Read the issue, latest comment first.
2. Read git: the branch, \`git log\` since the base commit, and
   \`git worktree list\`.
3. Check open pull requests and their CI runs.
4. Run the command from the update, and confirm you see what it describes.
5. Carry on with the next action. If anything disagrees with the update,
   tell the user before acting on either.
`;

/** Plans, milestones, open questions and the premises an issue rests on. */
export const PLANNING = `# Planning

How AGENTS.md's Plans rules work in practice. Read it before planning work
or filing an issue. temple-bar's setup wrote this file.

## Plans

- A plan is scaled to the change: a one-line fix needs a branch, not a
  plan.
- Break the work into verifiable phases, say which can run in parallel,
  and rate each one **routine**, **involved** or **delicate**, so the user
  can choose models.

## Milestones

- The user sets scope by placing issues in a milestone. Its plan is a short
  file, \`docs/plans/<milestone>.md\`, approved through a pull request.
- You group the milestone's issues into phases by the files each touches,
  and give each phase that closes several issues its \`One concern:\` reason.
- Progress goes on the issues, never in the plan.

## Open questions

- **At filing,** ask the issue's open questions there and then. The issue
  body has a **Decided** section and an **Open questions** section; later
  decisions are added to Decided.
- **Before a milestone's plan is approved,** run a decide-first pass: every
  open question across its issues, in one sitting, each with its
  background restated. Questions that need facts get a short look first.
  The plan is approved only when none remain, or each remaining one is
  marked "agent decides".
- **During the build,** ask anything genuinely new with its context
  restated: the issue, why it was filed, what was decided before, the
  options and a recommendation. The user never has to remember.

## Decisions and premises

- Decisions agreed in discussion become ADRs in \`docs/adr/\`, from
  [the template](adr/0000-template.md), which the user approves.
- Briefs, summaries and every issue's premise are checked against the ADRs
  and git history, not memory.
- A new issue cites what set the current state: an ADR, a commit or a pull
  request.
`;

/** A pull request's title and description, pushing, and merging as admin. */
export const PULL_REQUESTS = `# Pull requests

How AGENTS.md's pull request rules work in practice. Read it before opening
a pull request. temple-bar's setup wrote this file.

## Title and description

- **The title** (and every commit message) takes a conventional prefix
  (\`feat\`, \`fix\`, \`docs\` or \`chore\`), is proportional to the change, and
  names the change, never the trigger ("address feedback").
- **One bullet per distinct change,** as a top-level list: merge turns the
  title and those bullets into the squash commit.
- **Each issue or pull request reference** goes on its own nested line
  under the change bullet it belongs to, for example \`  - Closes #N\`, on
  one physical line: a wrapped nested line is joined onto its parent
  bullet. A description with no bullets puts its closing reference on a
  line of its own.
- **A \`One concern:\` line** when the pull request closes two or more
  issues or is over the size limits, giving a reason that counts. The
  reasons that count are in [the rationale](agents-rationale.md).

## Pushing and merging

- Every push runs the full CI, so push once, when the work is final.
- \`pnpm merge <N>\` runs whatever the current folder's \`package.json\` says.
  Inside a pull request's worktree that is the pull request's own scripts,
  so run it from the default-branch checkout.

## Merging as admin

The judge refuses a pull request that changes the checks it guards, so
\`temple-bar merge\` can't land it: the user merges it as admin on GitHub. Any
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
- a \`One concern:\` line when the pull request closes several issues or is
  over the size limits, because an admin merge skips merge's own
  enforcement;
- anything specific to the change. For a pin bump: the lockfile's integrity
  hash matches the one npm publishes, and the \`package.json\` and lockfile
  diffs, read in full rather than as a list of files, hold nothing
  unrelated.

Setup doesn't set GitHub's squash-message default, so a repository's default
may differ: the merge preview is where a wrong message is caught.
`;

/** What an orchestrator and its subagents each own, and the review bar. */
export const DELEGATION = `# Delegation

How AGENTS.md's Delegation rules work in practice. Read it before
delegating. temple-bar's setup wrote this file.

- **Delegate to keep the reviewer's context clean,** not only to go faster.
  Justify parallel work, and never split it across overlapping files.
- **Don't edit a file you delegated** until its subagent reports back.
- **Shared files** (root \`package.json\`, the lockfile, tsconfig, lint
  config) are the orchestrator's. Subagents commit only; every merge and
  push is the orchestrator's.
- **A handoff report** has three parts: _resolved_, _deliberately
  deferred_, _needs a decision_. It gives break-it evidence for each new
  check, and says whether anything ran outside the sandbox.
- **The review bar:** the orchestrator reads every line of a subagent's
  change, lists what it must defend against, and checks each item.
  Rerunning the checks is not a review.
`;

/** Searching for a known gap before proposing an incident, and filing one. */
export const INCIDENTS = `# Incidents

An incident records something that went wrong while working under
temple-bar's rules: rework, confusion, a rule that made things harder, or a
rule broken. The user saying twice that something is still broken is one
too. Agents see these in the moment; temple-bar's maintainers see which of
them matter across projects. temple-bar's setup wrote this file.

1. **Search first.** Before asking the user anything, search
   [temple-bar's issues](https://github.com/londontypescript/temple-bar/issues),
   all of them, not only incidents. Find incidents by the \`incident\` label
   and by "incident:" in the title, since not everyone who files one can set
   the label.
2. **If one matches,** name and link it to the user as the known gap, and
   don't propose a new incident. Offer a comment on it only when this case
   adds something it doesn't already say.
3. **If nothing matches,** propose the incident to the user there and then,
   saying the search found nothing.
4. **On the user's yes,** open an issue in temple-bar's issues titled
   \`incident: <what went wrong>\`, or post the comment you offered. Never in
   this project's own repository, and never with private details (customer
   data, internal hostnames).

The user decides which incidents are raised; temple-bar's maintainers
curate them from there.
`;
