# Planning

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
  file, `docs/plans/<milestone>.md`, approved through a pull request.
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
