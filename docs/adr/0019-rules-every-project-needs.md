# ADR 0019: Rules every project needs

Date: 2026-10-28. Status: accepted (decisions 91 to 98 for 0.2.2).

## Context

A new project set up with temple-bar (west-end) hit gaps in the rules setup
installs, and this repo's own 0.2.0 and 0.2.1 releases hit more. The maintainer
placed ten issues in milestone 0.2.2, ahead of 0.3.0's setup work. Their open
questions were settled in one decide-first pass on 2026-10-28, after an
adversarial review by ChatGPT Sol 6.1. The phase ratings were also reviewed by
Claude Fable 5.1.

## Decision

**91. Phase ratings have written criteria, and there are five.** Until now the
rules said only that each phase is rated routine, involved or delicate "so the
user can choose models", and agents read the words differently
([#473](https://github.com/londontypescript/temple-bar/issues/473)). temple-bar
stays model-free: a rating describes the work, and each user's own settings
decide what a rating gets. The installed `docs/planning.md` holds this text,
and the block names the five levels:

> Rate each phase by two questions: how much the brief leaves to the builder's
> judgement, and whether a wrong result would show before it does harm. The
> rating is the highest level any step reaches, with a one-line reason naming
> that step. Rating is part of plan approval.
>
> - **mechanical:** no choice left. Every step is spelled out, and done is
>   checked directly against the brief.
> - **routine:** judgement within an established pattern (from the codebase or
>   a documented standard) that covers the constraints and failure cases, so
>   only local details remain. A wrong result shows in the checks or the diff.
> - **involved:** investigation or choices no established pattern settles: a
>   new module, command or data flow; the options for an open decision;
>   diagnosing an unfamiliar failure. A wrong result still shows before merge;
>   it just takes more work to get right.
> - **delicate:** the answer is established, but the mistakes that matter are
>   ones a passing check wouldn't show: an input that slips past a boundary, a
>   race, a real host's behaviour, a rule that reads two ways, deleting
>   something outside the pull request. Name the failure.
> - **critical:** no established answer, and later phases build on whatever is
>   chosen, so a wrong choice means a costly migration: a security design with
>   no reference answer, the first design of a foundation.
>
> Ask in order:
>
> 1. Does the brief leave any choice? No: mechanical.
> 2. Is there no established answer, and will later work build on this one?
>    Yes: critical.
> 3. Would a wrong result show before merge (a check, a test the brief names,
>    or the diff)? Yes: routine with a pattern to follow, otherwise involved.
>    No: delicate.
>
> A phase that only investigates is never above involved. If a fact is
> missing, give a provisional rating and name the fact that could change it. A
> step that can't be undone (a tag, a publish) is rated by how it is carried
> out, usually mechanical; its risk is rated in the phase that designs or
> prepares it, and the step runs only on the user's yes. Ratings never choose
> a model, effort, review or workflow.

Examples illustrate; they never decide a rating by category. Two ratings change
from past practice: a new rule others follow is delicate (0.2.0 rated one
involved), and an open design a foundation rests on is critical.

Rejected: a sixth "human" level for steps only the user takes. The go-ahead is
an approval, not a measure of the work. Also rejected: rating every
irreversible step critical, which would give a rehearsed publish the same label
as an unsettled security design.

**92. A step that can't be undone runs only on the user's yes.** The block's
yes-first rule named only tagging and publishing. It now covers any step that
can't be undone: a tag, a publish, deleting history, or deleting work that
isn't on the default branch.

**93. `gate` and `merge` refuse to run a temple-bar other than the pinned
one** ([#462](https://github.com/londontypescript/temple-bar/issues/462)).
After a pin bump was pulled without reinstalling, `merge` ran the old version
and dropped a `Reviewed-by` trailer. Before any check runs or report is written
(all three gate modes), and before `merge` calls GitHub or changes anything,
the running package's version is compared with the exact version the relevant
checkout's root `package.json` pins; on a mismatch the command refuses and
names `pnpm install --frozen-lockfile`. `ready` gets the check through its
gate run. A missing pin or a range isn't checked, as `hooks/pnpm-check.ts`
already treats pnpm. Releases before this one can't refuse, so a long-lived
checkout needs one reinstall after it ships. Rejected: also refusing a missing
or non-exact pin, which can block a project that pins temple-bar another way.

**94. Setup writes `.gitattributes` only when a project has none**
([#478](https://github.com/londontypescript/temple-bar/issues/478)). It holds
`* text=auto eol=lf`, so a fresh clone on Windows checks files out with LF and
the gate passes. An existing file is left alone, and setup reports the line to
add when it isn't there. Setup also says what an existing Windows checkout
needs, since a new attributes file doesn't rewrite files already checked out.
Rejected: appending the line, which would override a project's own rules (a
later line wins), and an exact-line check, which a later line can undo.

**95. Setup reports each companion guide that differs from its release's
copy.** Setup replaces the block on an upgrade but leaves an existing
`docs/planning.md` or `docs/pull-requests.md` alone, and said nothing about it,
so an upgraded project would keep old guides next to a new block. Setup now
names each guide that differs, with "replace it unless you've edited it". It
only reports. Automatic, hash-based guide upgrades are later work.

**96. `ready` warns when a branch passes the size limits**
([#475](https://github.com/londontypescript/temple-bar/issues/475)). After a
passing gate, `ready` measures the branch the way `merge` does (`pr/size.ts`:
source lines, test lines and files, each configurable) and warns, never
refuses. A failed measurement is itself only a warning. The block's
one-concern rule states the default limits.

**97. A pull request carries its issue's milestone**
([#450](https://github.com/londontypescript/temple-bar/issues/450)). Prose
only: the pull request's milestone mirrors its issue's and is never a way to
add scope. This revises the 2026-10-15 practice that milestones go on issues
only.

**98. In a parallel wave, `docs/enforcement.md` rows land after the wave**
([#444](https://github.com/londontypescript/temple-bar/issues/444)). Each
phase reports the row it needs in its handover, and the orchestrator adds them
in one docs pull request after the wave's last merge. Rejected: git's
`merge=union` driver for the file, which silently keeps two contradicting edits
of one row or paragraph, and one file per rule with a generated table, a new
mechanism for a conflict that takes about a minute to resolve.

## What would end it

- Ratings: two agents given the same brief still reach different ratings, or
  a rating needs process attached to mean anything.
- The version refusal: pnpm itself refusing a stale install, or the refusal
  blocking a legitimate way of running temple-bar.
- The guide report: hash-based guide upgrades landing.
- Enforcement rows: a wave where the late rows misled someone, or a mechanism
  that removes the conflict at no cost.
