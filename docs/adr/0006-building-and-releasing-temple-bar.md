# ADR 0006: How temple-bar itself is built, gated and released

Date: 2026-10-01. Status: accepted (decisions 6, 7, 8, 9 and 26, and two
choices settled before the first planning session).

## Context

temple-bar is a tool that judges other repos, so the way its own source
becomes a release matters twice: a broken release breaks every repo that pins
it, and a release that judges its own source could switch off its own checks.
These decisions form one chain, from the language it is written in to the
registry it ships through.

## Decision

**Settled before planning: TypeScript on Node, built-ins only.** The
machinery uses Node built-ins only. Bash appears only as one-line hook shims
that call Node, and there is no Python. The packages ship JavaScript built by
`tsc`, because Node's type stripping refuses `.ts` files under
`node_modules`, which a test proves on every supported Node version.

**Settled before planning: the npm registry only.** temple-bar is published
to npm, and not to other registries such as JSR, for now. This is about where
the package is published; which package manager installs it is decision 5's
subject ([ADR 0005](0005-setup-hooks-and-worktrees.md)).

**Decision 9: toolchain.** pnpm workspaces, which is also the convention for
every London TypeScript repo. Node 24 or newer, with CI on Node 24 and 26 ×
Ubuntu, macOS and Windows. Windows is required: early in the build, tests
reviewed on macOS only failed on Windows, and only CI caught it. ESLint with
typescript-eslint's strict type-checked rules, and Prettier.

The first plan was Vite Plus. It was set aside because its lint rules aren't
yet as strict as ESLint with typescript-eslint, and Vite Plus itself is still
in beta. It's worth looking at again once it is stable and matches ESLint and
Prettier.

**Decision 26: test isolation.** The whole suite runs shut off from the
machine's git config (`GIT_CONFIG_GLOBAL` points at an empty file, and there
is no system config). Tests had inherited a developer's global commit-signing
setting, so they failed in some local sessions, passed in CI, and once passed
locally only because a passphrase happened to be cached.

**Decision 6: bootstrap (stage0).** The repo had plain checks, 3-OS CI and
GitHub protection from its first commit. Phase 1 built a minimal core and
published it, and the repo then pinned it. Something had to protect the repo
before any release existed to protect it.

**Decision 7: self-use.** temple-bar's repo is gated by its own **last
published release**, never its own source, like TypeScript's "last known
good" compiler. A change can't weaken the checks that judge it, because those
checks come from a release that was already reviewed and published. Pin bumps
are deliberate, reviewed changes in their own pull request, and no feature
exists to make the repo run its own source as its tooling.

**Decision 8: publishing.** Only CI publishes, through npm trusted publishing
with provenance, so every release can be traced to the commit and workflow
that built it. One exception, now done: the maintainer published `0.0.1` of
each package by hand, because trusted publishing only works for packages that
already exist. Releases since then come from CI: the release workflow runs the
full 3-OS CI on the exact commit first, then stages both packages, and the
maintainer approves each one on npmjs.com with 2FA. The workflow leaves a
draft GitHub Release, and `pnpm release:publish <tag>` publishes it only once
both package files download from npm: in 0.0.4, npm listed the new version
minutes before its files could be installed, and a Release published on the
listing alone announced a version nobody could install yet. Tagging and
publishing also need the maintainer's yes before the orchestrator starts them
([ADR 0003](0003-how-a-change-reaches-main.md), decision 18).

## What would end it

Self-gating by the last release is wrong if releases become so rare that the
checks judging the repo fall far behind its source, so that new work goes
unchecked for long stretches. CI-only publishing ends if npm trusted
publishing stops offering provenance or staged approval. The npm-only and
Node-built-ins choices would end if London TypeScript repos moved to another
registry or runtime.
