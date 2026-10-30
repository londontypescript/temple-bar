# Planning

How AGENTS.md's Plans rules work in practice. Read it before planning work
or filing an issue. temple-bar's setup wrote this file.

## Plans

- A plan is scaled to the change: a one-line fix needs a branch, not a
  plan.
- Break the work into verifiable phases, say which can run in parallel,
  and rate each one as below.

## Ratings

Rate each phase by two questions: how much the brief leaves to the builder's
judgement, and whether a wrong result would show before it does harm. The
rating is the highest level any step reaches, with a one-line reason naming
that step. Rating is part of plan approval.

- **mechanical:** no choice left. Every step is spelled out, and done is
  checked directly against the brief.
- **routine:** judgement within an established pattern (from the codebase or
  a documented standard) that covers the constraints and failure cases, so
  only local details remain. A wrong result shows in the checks or the diff.
- **involved:** investigation or choices no established pattern settles: a
  new module, command or data flow; the options for an open decision;
  diagnosing an unfamiliar failure. A wrong result still shows before merge;
  it just takes more work to get right.
- **delicate:** the answer is established, but the mistakes that matter are
  ones a passing check wouldn't show: an input that slips past a boundary, a
  race, a real host's behaviour, a rule that reads two ways, deleting
  something outside the pull request. Name the failure.
- **critical:** no established answer, and later phases build on whatever is
  chosen, so a wrong choice means a costly migration: a security design with
  no reference answer, the first design of a foundation.

Ask in order:

1. Does the brief leave any choice? No: mechanical.
2. Is there no established answer, and will later work build on this one?
   Yes: critical.
3. Would a wrong result show before merge (a check, a test the brief names,
   or the diff)? Yes: routine with a pattern to follow, otherwise involved.
   No: delicate.

A phase that only investigates is never above involved. If a fact is
missing, give a provisional rating and name the fact that could change it. A
step that can't be undone (a tag, a publish) is rated by how it is carried
out, usually mechanical; its risk is rated in the phase that designs or
prepares it, and the step runs only on the user's yes. Ratings never choose
a model, effort, review or workflow: the user's own settings decide what
each rating gets. Examples illustrate; they never decide a rating by
category.

## Milestones

- Milestones are named as versions: `0.MINOR.0` for a planned release, a
  patch version for a fix inserted before it, so an inserted fix never
  renames the milestones after it. Any descriptive name goes in the
  milestone's description.
- The user sets scope by placing issues in a milestone. Its plan is a short
  file, `docs/plans/<version>.md`, approved through a pull request.
- You group the milestone's issues into phases by the files each touches,
  and give each phase that closes several issues its `One concern:` reason.
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

- Decisions agreed in discussion become ADRs in `docs/adr/`, from
  [the template](adr/0000-template.md), which the user approves.
- Briefs, summaries and every issue's premise are checked against the ADRs
  and git history, not memory.
- A new issue cites what set the current state: an ADR, a commit or a pull
  request.
