# ADR 0002: What temple-bar is for, and what it will not be

Date: 2026-10-01. Status: accepted (decisions 2, 3, 11, 28, 29 and 31, and
three choices settled before the first planning session).

## Context

temple-bar makes AI coding agents follow a workflow by enforcing it, instead of
trusting them to remember it. A tool like that can drift into trying to suit
everyone: every git host, every package manager, every agent. These decisions
draw its boundary: who it is for, what it requires, and what it leaves out.

## Decision

**Settled before planning: the repo, the packages and the licence.** The repo
is `londontypescript/temple-bar`, public from day one. It ships two packages,
`@londontypescript/temple-bar` and the launcher
`@londontypescript/create-temple-bar`, and one command, `temple-bar`. MIT
licence.

**Settled before planning: models.** Every phase of a plan is rated
**routine**, **involved** or **delicate**, so the maintainer can choose which
model does it. The maintainer picks the models; temple-bar and the agents
working on it never pick or switch one. This replaces an earlier default that
named fixed models for orchestrating and implementing; AGENTS.md §1 holds the
rule today.

**Settled before planning: the earlier hardening plan.** temple-bar grew out of
a frozen hardening plan for an earlier version, whose items were numbered D1
to D7. Four carried over:

- D2, detecting a project's stack beyond its npm scripts, is planned for
  theme B ([#50](https://github.com/londontypescript/temple-bar/issues/50)).
- D3's canary per rule is planned for theme B
  ([#53](https://github.com/londontypescript/temple-bar/issues/53)). Its
  "`main`'s copy of the checks judges" is still needed, but needs its own
  design, because pull request CI runs the pull request's own copy of the
  workflow ([ADR 0007](0007-what-the-gate-checks.md),
  [#55](https://github.com/londontypescript/temple-bar/issues/55)).
- D4's pre-merge-commit guard is mostly replaced by decision 4; whether it
  still adds anything is re-checked
  ([ADR 0003](0003-how-a-change-reaches-main.md)).
- D7 became the models rule above: temple-bar never picks a model.

**Decision 2: public, but highly opinionated.** temple-bar ships the
maintainer's defaults, makes no promise of configurability, and stays on 0.x
versions. The README says so up front. This guards against users expecting a
general-purpose tool that bends to every workflow, and against options that
weaken the enforcement temple-bar exists for.

**Decision 3: GitHub only.** Setup requires a git repo, `gh` installed and
signed in, and `origin` on GitHub. There is no "local merges" mode: `main`
changes only through pull requests ([ADR 0003](0003-how-a-change-reaches-main.md)),
so a mode without GitHub would have nothing to enforce that rule with.

**Decision 11: no timebox.** The first real release is defined by its scope,
not a date.

**Decision 28: a solid foundation first.** temple-bar and grand-union are the
foundation of the London TypeScript GitHub org. grand-union starts once
temple-bar 0.0.8 ships: a first run that works, an enforced merge path,
worktrees that work safely wherever a tool puts them, rules that can't be
quietly weakened, and everything the earlier template did. The
remaining themes continue alongside grand-union, so it starts on a foundation
that holds rather than waiting for every theme. Until 2026-10-01 this decision
said every theme (A to F) came first; it changed once the releases up to 0.0.7
were planned and the rest proved to be later, separable work. On 2026-10-02
a small worktree release was inserted as 0.0.6, so the same scope now ends at
0.0.8.

**Decision 29: working, well-made code first; a showcase second.** The code
must first work and follow sound standards, in both the code and the
architecture: strict types, tests that protect real behaviour, deep modules
behind simple interfaces, and clear seams. Being an example that TypeScript
developers of every level can learn from comes second, and never at the cost
of correctness. Every contested choice needs a written rationale: a decision
in the plan or an ADR. Until 2026-10-01 this decision led with the code having
to impress; the order changed so that correctness and standards always come
first. New code follows the comment convention in AGENTS.md §5:
comments explain why in plain words, with no internal plan IDs. Once every
theme is built, one full quality pass goes over the settled code: plain
comments in place of the plan IDs, repetition removed, a newcomer's map of the
code, and the ADRs behind it.

**Decision 31: built for every London TypeScript repo.** temple-bar exists so
every London TypeScript repo works the same way under the same constraints.
GitHub, `gh` and pnpm are required (decisions 3 and 9); being useful elsewhere
is a bonus, never the aim. So where a step goes through git, GitHub, `gh` or
pnpm, temple-bar does it itself rather than leaving it to each agent. Agent
harnesses stay open, because people use Claude, ChatGPT and Gemini for
different tasks, so harness choices stay neutral and temple-bar checks their
harms ([ADR 0005](0005-setup-hooks-and-worktrees.md)). Every branch gets its
own worktree by default: setup takes about 1.5 seconds with pnpm's shared
store, and parallel work never collides.

The reason behind 31 was an incident: practices the project relied on lived
only in one agent's private memory and notes, so they drifted, and another
agent would never have seen them. Practices a project relies on belong in
AGENTS.md first, then in temple-bar itself.

## What would end it

This boundary is wrong if London TypeScript repos stop sharing one host, one
package manager and one workflow, for example if some move off GitHub or off
pnpm. Then "the same constraints for every repo" no longer holds, and
supporting several hosts or package managers becomes the aim rather than a
bonus.
