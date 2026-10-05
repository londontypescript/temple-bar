# ADR 0009: The README, AGENTS.md and who writes them

Date: 2026-10-01. Status: accepted (decisions 1, 12, 19 and 36; the gate's
check of 36 is not built yet).

## Context

Two files are read first by everyone who meets temple-bar: the README, by
people deciding whether to use it, and AGENTS.md, by every agent in every
session. These decisions set what each says, how large AGENTS.md may grow,
and who writes the README.

## Decision

**Decision 1: what the README says.** The README opens with a plain
two-sentence intro: what temple-bar does, and why it exists. Then come the
requirements, getting started and the steps for agents, and after them the
background: the deterministic workflow around a non-deterministic agent, the
blocked / detected / prompted / prose-only labels for how strongly each rule
is held, London TypeScript, and the story of the name. The incident loop
appears as an "in progress" outline. The decision first had the README open
with the slogan "Prose != Enforcement"; the slogan was dropped on 2026-10-01,
when the README was restructured at the maintainer's direction to put a plain
intro first. On 2026-10-05 the intro became one bold line, the same sentence
as the npm and GitHub descriptions, followed by the quote "A rule that exists
only as prose is a rule that will eventually be violated." The plain intro
still comes first.

**Decision 12: the TypeScript trademark.** temple-bar never uses the
TypeScript logo, and always writes "TypeScript" with a capital S. Its README
and packages carry no trademark disclaimer, because the name temple-bar
doesn't use the mark. Microsoft's guidelines, read on 2026-09-28,
discourage marks in community names, while TypeScript's branding page only
restricts product use; this was judged low risk. The decision also placed a
disclaimer on the London TypeScript org profile; that half is organisation
work, out of temple-bar's scope since 2026-09-30.

**Decision 19: the maintainer owns the README's shape; agents keep it
accurate.** Agents update the README themselves when a change is minor:
keeping it in step with what the code does, such as a new setup step or a
renamed command. A rewrite, a new structure or a change to what the intro
says temple-bar is stays the maintainer's to lead, shown as a draft first.
The decision began as "the maintainer writes the README" after an incident:
an agent folded "rewrite the README" into its own plan, because the decision
said when but not who. On 2026-10-01 it was relaxed for minor changes, once
the README had its plain structure and drafts for small edits had become
pure overhead.

**Decision 36: AGENTS.md stays within 200 lines and 32 KiB.** Every agent
loads the whole file in every session. Anthropic's guidance is under 200
lines (Claude Code warns above it), and Codex stops reading past 32 KiB by
default. Research in 2026 found instruction files raise cost without raising
success, and that repository overviews don't help, so the file holds only
rules an agent must follow in every session. Reference material and reasons
move to docs ([docs/agents-rationale.md](../agents-rationale.md)), and the
enforcement table lives in [docs/enforcement.md](../enforcement.md). When a
mechanism ships, its rule shrinks to one line. The gate will check both
limits, on this repo and on every London TypeScript repo's AGENTS.md; not
built yet (theme B).

## What would end it

The AGENTS.md limits are wrong if the agents in use stop loading the whole
file every session, or raise the size they read. The README order is wrong
if newcomers can no longer tell from the intro alone what temple-bar does.
