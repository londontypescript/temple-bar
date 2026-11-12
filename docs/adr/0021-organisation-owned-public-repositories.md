# ADR 0021: Repositories temple-bar sets up are public and owned by an organisation

Date: 2026-11-12. Status: accepted (decision 100, for 0.3.0;
[#359](https://github.com/londontypescript/temple-bar/issues/359)).

## Context

temple-bar's protection rests on one fact about GitHub: only the
repository's admins can merge past its rulesets, and the judge's ruleset
lets them do so only through an explicit admin merge
([ADR 0011](0011-which-checks-judge-a-pull-request.md)). Setup also needs a
public repository: on GitHub Free a private one refuses rulesets, and the
gate's ruleset check reads the rules only on a public one (decision 43,
[ADR 0004](0004-github-settings-temple-bar-applies.md)).

Until 0.3.0 setup said nothing about who owns the repository. On 2026-10-10
the maintainer set the supported scope as public repositories in the
London TypeScript organisation only. Then:

- An agent made a new organisation repository private, and GitHub refused
  the rulesets with HTTP 403 only after scaffolding, setup and a merge.
- On 2026-10-14 `--create-repo` ran `gh repo create <folder> --public …`
  with no owner, so `gh` created the repository in the user's personal
  account. Nothing in the README, setup's output or its question named an
  owner, so following them exactly still went wrong. On 2026-10-27 setting
  up west-end hit the same command, and the repository was made by hand.

The decide-first pass on 2026-10-30 answered "any owner the user names and
agrees", and phase P probed what that would mean on throwaway public
repositories:

- On a personal repository, rulesets block a direct push to `main`, but the
  owner's plain `gh pr merge` (no `--admin`) merged past the judge's
  required check, recorded as a bypass. In the organisation the same merge
  was refused, even with CodeQL finished and passing.
- Transferring the personal repository into the organisation kept both
  rulesets, but emptied the judge ruleset's bypass list, so the admin-merge
  path was gone until something added it back.

So on a personal repository the one person who merges also merges past
every check without being asked, and moving it into an organisation later
silently breaks the admin path.

## Decision

**Decision 100: setup works only on public repositories owned by a GitHub
organisation.** This replaces the 2026-10-30 "any owner" answer, and
widens the 2026-10-10 scope from London TypeScript alone to any
organisation.

- **Checked before setup writes anything.** For an existing `origin`, setup
  asks GitHub for the repository's owner type and visibility. A personal
  account is refused by name, saying to prototype without temple-bar and
  ask an organisation admin for a repository. A repository that isn't
  public is refused: setup never changes a repository's visibility, since
  making one public publishes its whole history, every commit's name and
  email included. An answer setup can't read, or a repository GitHub
  doesn't show, is refused too, never assumed fine.
- **A new repository's owner is always named.** `--owner <organisation>`
  carries the user's answer. Setup's question and its no-terminal stop
  name `<organisation>/<name>`, the command it runs always includes the
  owner, and `--create-repo` without `--owner` is refused. An owner that is
  a personal account is refused by name before anything is written. Setup
  creates only public repositories.
- **No pre-check of permission to create.** If the organisation refuses,
  `gh`'s message is reported and nothing is pushed. Whether `origin` uses
  HTTPS or SSH is left to `gh`; a push that fails after the repository was
  created is reported with its fix, and setup stops before anything else.

**Alongside, on the same path** (decided on
[#363](https://github.com/londontypescript/temple-bar/issues/363) and
[#361](https://github.com/londontypescript/temple-bar/issues/361)): before a
new repository's first push, setup's question and its no-terminal stop
list every distinct commit identity the push would publish (the history's
authors, committers and co-authors, the configured identity, and any
environment override), with a short code. `--create-repo` goes ahead only
with `--identities <code>` matching the identities read at that moment,
so a commit or setting changed after the user agreed stops it. Setup never
rewrites history and states no preference for GitHub's noreply addresses.
A public repository with no LICENSE gets a note, never a failure; the
licence is the user's choice.

ADR 0004's sentences about private repositories (CodeQL left off on one;
decision 43's ruleset check) still describe the gate, but setup no longer
reaches a private repository.

## What would end it

This is wrong if GitHub gives a personal repository a way to stop its owner
merging past required checks, or if a repository that has to be private
needs temple-bar. Either way, the rule is reopened as a new decision: a
private repository needs rulesets and code scanning that GitHub Free
doesn't give it.
