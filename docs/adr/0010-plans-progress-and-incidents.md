# ADR 0010: Where plans, progress and incidents live

Date: 2026-10-01, updated 2026-10-24. Status: accepted (decisions 37, 38, 39,
55 and 57; decision 27 is superseded by 37 and kept here as history).

## Context

Work on temple-bar is planned, tracked and resumed across many sessions and
several agents, and usage limits cut sessions off mid-phase. Wherever
progress lives, the next session has to find it without asking the
maintainer to remember. Incidents, the record of what went wrong, need a home
that the maintainer can curate and that improves temple-bar itself.

## Decision

**Decision 27 (superseded): record versus live tracker.** Git held the
decisions, phase definitions, incidents, and each phase's status at start and
end. Subtask progress and the session handoff lived in a gitignored
`planning/` folder, readable by every agent. That moved the handoff out of
one agent's private memory.

**Decision 37: GitHub issues are the tracker** (supersedes 27). Every piece of
planned work is an issue, and the agent working on it keeps it current at
every subtask. A new session resumes from the issue plus git; there is no
handoff file. Git keeps the record: decisions, phase definitions and history,
ADRs and AGENTS.md. Local drafts live in the gitignored `.temple-bar/` folder: this checkout's
working folder for anything temple-bar or its agents keep locally. (It was
`planning/` until 2026-10-01; a name that common could clash with a
project's own folder.)

**Decision 38: incidents improve temple-bar only.** When an agent doesn't do
what it should, it proposes an incident and asks the maintainer there and
then. If they agree, it searches temple-bar's issues and opens a new one
titled `incident: …`, or comments on or updates a similar one. (Until
2026-10-05 it said "labelled `incident`", but GitHub silently drops labels
set by anyone without write access to the repo, which is everyone outside
temple-bar's maintainers; the title works for anyone, and temple-bar's
side does the labelling.) Never in the
project's own repo, never with private details. Incidents are built in two
halves because agents see what went wrong in the moment, while the
maintainer sees which of those matter across projects.

**Decision 39: no project board until grand-union starts.** grand-union then
gets its own project, because it is large and expected to be busy all the
time. temple-bar either gets a project of its own or joins a London
TypeScript-wide one; that is decided when it's needed. Until then, labels,
milestones and saved views on temple-bar's own issues are enough.

**Decision 57: a short plan file per milestone; decisions in ADRs**
(decided 2026-10-05, for the AGENTS.md template; temple-bar's own plan moved
to it in 0.2.0, when its decisions list became an index of the ADRs under
decision 89, [ADR 0016](0016-agent-rules-and-the-merge-loop.md)). A milestone's plan is `docs/plans/<milestone>.md`: its
phases, the files each owns and each phase's `One concern:` reason, approved
through a pull request. Decisions are ADRs in `docs/adr/`, and briefs are
checked against them. Progress stays on the issues. Plans were not moved into
the issues entirely: in git a plan is reviewed before it changes, readable
offline and without a GitHub login, tied to the commits it describes, and
safe from two agents overwriting each other's edit to an issue body. One file
per milestone, rather than one plan for the whole project, keeps it short
enough to read on every resume.

**Decision 55: work is planned by milestone across the organisation**
(decided 2026-10-04, while planning 0.0.8). The user sets scope by placing
issues in a milestone, in every London TypeScript repo. When a milestone is
planned, the agent groups its issues into phases by the files each change
touches, and the user approves the plan. Placing an issue in a milestone is
the user's judgement of what matters and when; grouping by files is something
an agent sees better, so the agent proposes it and the plan's approval covers
it. It replaced the rule that the user writes a grouped intake of the work.
Until 2026-10-24 this decision's home was
[docs/agents-rationale.md](../agents-rationale.md); it moved here under
decision 89.

## What ended decision 27

A gitignored folder exists in one checkout on one machine. An agent in a
cloud session, or in a checkout elsewhere, couldn't read it, and nothing in
it was visible to anyone following the project. On 2026-10-01 planned work,
open questions, the maintainer's remaining steps and kept incidents moved to
GitHub issues, where every agent and person can read them, and the handoff
file was deleted.

## What would end it

This is wrong if GitHub issues stop being reachable by the agents doing the
work, for example a harness with no access to `gh`. Then progress would need
a home those agents can read and write, and decision 37 would need replacing
the way it replaced 27.
