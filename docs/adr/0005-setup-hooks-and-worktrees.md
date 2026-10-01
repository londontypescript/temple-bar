# ADR 0005: Setup, hooks and worktrees

Date: 2026-10-01, updated 2026-10-02. Status: accepted (decisions 5, 16, 21,
22, 30 and 32; 32 is built, while 16's checks and 30 are decided but not
built yet).

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

The cause was where the hooks lived. `core.hooksPath` was the relative path
`.githooks`, in config every worktree shares, while the hook files were
tracked in the repo. git resolves a relative hooks path against each
worktree's own files, so which hooks ran depended on the branch each worktree
had checked out: none on a branch from before setup, and a fast-forward that
brought `.githooks/` in wrote the files before it moved the ref, so the hooks
appeared half-way through, in a checkout with no `node_modules`. So:

- **The hooks live in git's own hooks folder in the shared git directory**
  (`<git-common-dir>/hooks/`), with `core.hooksPath` unset. The same hooks
  run in every worktree, whatever its branch. `hook install` removes
  `core.hooksPath` when it is `.githooks`, as earlier releases set it, and
  reports any other value as a conflict. The tracked `.githooks/` folder is
  no longer used; setup never deletes, so removing it is the user's step.
  Per-worktree config (`extensions.worktreeConfig`) was rejected: it changes
  how other git tools must read the repo, and a new worktree would start with
  no hooks.
- **A hook runs the temple-bar that wrote the shims, else this worktree's,
  else another worktree's.** Each install that puts its own shims in place
  records its checkout beside them. An older temple-bar, pinned by an older
  branch, may not know every hook the shims call, so the writer goes first.
  A new worktree, or one whose branch predates setup, has no `node_modules`
  yet and is still checked. The checks then come from that copy's version,
  which may differ from the one this branch pins; that is accepted, since
  the hooks guard rules that hold across the repo.
- **Failing closed (decision 22) now means: no checkout has temple-bar.**
  That keeps the protection where nothing is installed anywhere, without
  refusing work in a checkout merely because its own install hasn't happened
  yet. It still refuses in a fresh clone before its first install.
- **A shim another temple-bar version wrote is kept, not a conflict.** Every
  worktree's `pnpm install` writes into the one shared folder, and a worktree
  on an older branch installs an older temple-bar. Its install must neither
  fail nor take the shims back to its own version; a newer release replaces
  the shims it knows from earlier releases.

The `post-checkout` hook acts only when git passes a previous HEAD of all
zeros and the checkout is a linked worktree, which is what `git worktree add`
produces (a fresh clone also passes zeros, but is the main worktree). Any
other checkout returns at once, without starting Node. In the new worktree it:

1. Copies env files from the main worktree: every git-ignored file whose name
   starts with `.env` and doesn't end in `.example`, at the root and in any
   folder git doesn't ignore, so a monorepo package's own `.env` comes too. A
   file goes in only if its folder exists on the new branch, never over a
   file already there, and keeps its permissions.
2. Checks every committed `<name>.example` env template against `<name>`,
   naming the keys the template lists and the file lacks, or that the file
   is missing. Only file and key names are printed, never a value.
3. Runs `pnpm install --frozen-lockfile` when the worktree has a
   `pnpm-lock.yaml`. If that fails, the hook exits non-zero and says the
   worktree exists and which command finishes the setup: a hook can't undo
   a checkout.

Env files come before the install, so they are in place even when the
install fails.

## What would end it

This is wrong if harnesses converge on one worktree location that temple-bar
could rely on: setting the location would then be simpler than detecting the
harms of every location. It would also need revisiting if
failing closed before install caused more harm than an unprotected checkout,
for example if most users never ran the install.
