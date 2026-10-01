# ADR 0005: Setup, hooks and worktrees

Date: 2026-10-01. Status: accepted (decisions 5, 16, 21, 22, 30 and 32; 16,
30 and 32 are decided but not built yet).

## Context

A repo gets temple-bar through setup, and its local rules arrive as git
hooks. Agents also create worktrees, one per branch, wherever their harness
puts them. Each of those moments can leave a checkout unprotected or broken:
a fresh clone with no hooks yet, a worktree with no dependencies, or a
worktree nested inside the repo where other tools trip over it.

## Decision

**Decision 5: setup.** The docs lead with a copy-paste prompt for the user's
agent, linking to the README's `#for-ai-agents` section, so the instructions
sit where the agent reads them. The command is
`pnpm create @londontypescript/temple-bar@latest`, which runs the thin
launcher `create-temple-bar`. temple-bar comes first, and scaffolding is phase
1 of the project's own plan; existing projects are supported. `init` asks
before any GitHub change, writes a `prepare` script, and never deletes
anything. The package has no install scripts: nothing runs merely because it
was installed, and the hooks go in through the project's own `prepare` script,
in plain view. The rules it installs make "ask the user what they're building"
the first step for a new project.

Until 2026-10-01 this decision said the command worked with every package
manager; it now says pnpm only, as decisions 9 and 31 require.

**Decision 21: fresh clones.** The README says the hooks arrive with the
install. Nothing more is built for it: the audience runs the install anyway.

**Decision 22: before install, hooks fail closed.** Where temple-bar isn't
installed yet, the hook shims refuse rather than let the change through. A
hook that quietly passed whenever its tool was missing would let `main` move
unchecked in exactly the checkouts nobody had set up. The friction this
causes (a checkout refusing a fast-forward until `pnpm install` has run) was
left open when 22 was decided. Decision 32 answers it for new worktrees; the
main checkout's case is
[#104](https://github.com/londontypescript/temple-bar/issues/104).

**Decision 16: worktrees.** The harness decides where worktrees go, and
`git worktree list` is the truth. temple-bar checks the harms instead:
dependencies installed and in sync, `.env` keys present (env files copied in,
keys checked and values never printed), and an explanation when tools scan
nested worktrees. This replaces the earlier brief's own worktree rules.

The same decision turns the brief's "branch only from a gated commit" into a
`reference-transaction` check keyed on what a branch is, not its name, so
renaming a branch can't get round it (theme D).

**Decision 30: the location stays the harness's choice; temple-bar checks the
harms, for every harness.** Each harness, and each person, puts worktrees
where its own mechanism does. temple-bar never sets or
assumes a location. It detects the harms of a worktree nested inside the repo
(not git-ignored, reached by ESLint or other tools, running on the main
checkout's `node_modules`) through git alone, so the checks are the same
whichever tool made it. Its docs recommend keeping worktrees outside the
repo, and explain why.

**Decision 32: temple-bar sets up every new worktree.** A `post-checkout` hook
runs when any tool calls `git worktree add`: it installs dependencies with
pnpm and copies the env files in (keys checked, values never printed). The
harness still picks the location. This turns decision 16's dependency and
env-file checks into setup, with the checks kept as the backstop.

The reason was an incident: after setup ran in a worktree, `core.hooksPath`
was set in the config every worktree shares, so a fast-forward in the main
checkout ran a hook before temple-bar was installed there, and the hook failed
closed. Worktrees on branches from before the setup had no hooks at all,
silently.

## What would end it

This is wrong if harnesses converge on one worktree location that temple-bar
could rely on: setting the location would then be simpler than detecting the
harms of every location. It would also need revisiting if
failing closed before install caused more harm than an unprotected checkout,
for example if most users never ran the install.
