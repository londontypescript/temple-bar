<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/temple-bar-dark-band-bottom-a936a88e.svg">
    <img alt="London TypeScript: Temple Bar" src="docs/images/temple-bar-light-band-bottom-ea0cc1a3.svg" width="100%">
  </picture>
</p>

Temple Bar is the London TypeScript workflow, enforced on AI coding agents via git hooks, a quality gate and GitHub rules. Agents drift: after a long session or a context reset, the agent that used branches all day commits straight to `main`. Written instructions don't stop that, so Temple Bar refuses the change instead. Every London TypeScript repository runs on it, and any TypeScript project using pnpm in a GitHub organisation can adopt it as it is.

> A rule that exists only as prose is a rule that will eventually be violated.

## Contents

- [Why? Prose != Enforcement](#why-prose--enforcement)
- [You need](#you-need)
- [Getting started](#getting-started)
- [For AI agents](#for-ai-agents)
- [Built for London TypeScript](#built-for-london-typescript)
- [Why "Temple Bar"](#why-temple-bar)
- [Contributing](#contributing)
- [Licence](#licence)

## Why? Prose != Enforcement

AI coding agents follow written rules most of the time, then drift. After a long session, a context reset or a usage-limit pause, the agent that carefully used branches for six phases commits straight to `main` in the seventh. Nothing noticed, because the rule was only ever words in a file.

Temple Bar turns those words into mechanisms. The model's judgement is never what enforces a rule: a script is, and it gives the same answer every time.

### A deterministic workflow around a non-deterministic agent

An agent's output will never be deterministic: ask twice and you get two different answers. The workflow around it can be. Temple Bar fixes the parts that must not vary and leaves the agent free inside them:

- **The same path every time.** Plan, approve, branch, commit, gate, pull request, merge. The steps don't depend on which agent is running, how long the session has been, or what it remembers.
- **The same verdict every time.** The gate runs the full suite on every merge, whatever changed. The same code always gets the same answer, locally and in CI.
- **The same limits every time.** What an agent may never do (commit to `main`, merge its own work, weaken a check to make it pass) is refused by a mechanism, not left to the agent to remember.

The agent decides _how_ to build something. Temple Bar decides _what counts as done_, and makes that the same on every run.

### How strongly each rule is held

Where a rule _can't_ be enforced by a script, Temple Bar says so. Every rule is labelled with how strongly it's actually held:

| Strength       | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| **Blocked**    | A hook, the gate or GitHub refuses it outright.                       |
| **Detected**   | Something notices afterwards and says so.                             |
| **Prompted**   | You're asked at the right moment; nothing checks the answer.          |
| **Prose only** | Written down, and nothing more. The weakest kind, and listed as such. |

When a rule is found to be prose-only and still being broken, the fix is a script, not stronger wording.

### Getting better from real incidents

Every rule in Temple Bar exists because something went wrong in a real project, and new ones arrive the same way:

1. **Capture.** When something goes wrong during a project, your agent proposes an incident. **You** decide which ones to keep.
2. **Report upstream.** Kept incidents that are about Temple Bar itself are filed as issues on this repository, with private project details left out: [about 30 so far](https://github.com/londontypescript/temple-bar/issues?q=label%3Aincident).
3. **Fix and release.** The fix lands here, through the same gate as everything else, and each release's notes list the incidents it fixes.
4. **Upgrade.** Your projects pick up the fix by upgrading the package, instead of each project patching its own copy.

Capture is prompted by the rules, not enforced: nothing checks that an agent proposes an incident when something goes wrong.

## You need

- a public **GitHub** repository owned by an organisation (other hosts, personal accounts and private repositories aren't supported)
- the **GitHub CLI** (`gh`), installed and signed in (`gh auth login`). Your agent can't install this for you.
- **Node.js** 24 or newer, and **git**
- **pnpm**, the only supported package manager (npm, yarn and bun aren't supported). Don't have it? See [pnpm's install guide](https://pnpm.io/installation): it's one command. Any of its installs works: npm (`npm install --global pnpm`), corepack, `pnpm/action-setup` in GitHub Actions, or pnpm's standalone installer. A pnpm reached only through a `.cmd` or `.bat` shim doesn't ([why](docs/what-setup-does.md#pnpm-through-a-shim)).
- type checks and tests that run through `tsc`, Vitest or Node's test runner ([why, and what isn't supported yet](docs/what-setup-does.md#type-checkers-and-test-runners))

Setup stops and tells you what's missing if any of these aren't in place.

## Getting started

Copy one of these into whichever coding agent you use.

**Starting something new:**

```text
Set up a new project with temple-bar, following
https://github.com/londontypescript/temple-bar#for-ai-agents
```

**Adding it to a project you already have:**

```text
Add temple-bar to this repo, following
https://github.com/londontypescript/temple-bar#for-ai-agents
```

### What happens next

1. **For something new, your agent asks you what you're building** and scaffolds the project first, with the framework's own tool (Vite, Next.js, Astro and the like) using its pnpm option, or by hand. Temple Bar comes second, because a scaffolder run afterwards can delete or replace what setup wrote.
2. Your agent runs Temple Bar's setup. If the folder isn't on GitHub yet, **it asks you** before creating the repository.
3. Setup writes the rules (`AGENTS.md`), installs the git hooks and asks whether to switch on `main`'s protection on GitHub.
4. Your agent points the gate's four checks at the project's own tools, then writes a **plan**. Nothing is built until you approve it.
5. From then on, work happens on branches, every change passes the gate, and you approve every merge to `main`.

### Cloned a repo that already uses Temple Bar?

Nothing to do: `pnpm install` switches the hooks on. A fresh clone has no hooks until you install.

### Doing it yourself

Scaffold the project first, with your framework's tool and its pnpm option (for example `pnpm create vite my-app`), or by hand. Then, in its folder:

```bash
git init
pnpm create @londontypescript/temple-bar@latest
```

In a project that's already a git repo, run just the last line. Every command takes `--help`, which shows the usage and changes nothing.

A project that installs with npm, Yarn or Bun moves to pnpm first: [switching to pnpm](docs/what-setup-does.md#switching-to-pnpm).

Then point the gate's four checks at your project's tools: `typecheck`, `lint`, `format:check` and `test` in `package.json`'s `scripts` (for example `tsc --noEmit`, `eslint .`, `prettier --check .` and `vitest run`). `pnpm gate` runs them all, and fails one that's missing or does nothing (`true`, `echo ok`), so set real commands, even for a small project.

Don't run a scaffolder after setup: some delete or replace `AGENTS.md` and `package.json` (Vite with `--overwrite`, Nuxt with `--force`), others refuse a folder that isn't empty or quietly create a subfolder.

### What setup does

Setup writes the rules into `AGENTS.md`, installs the git hooks, and adds the gate and three CI workflows. With your yes, it also switches on `main`'s protection and CodeQL code scanning on GitHub.

It never deletes files, rewrites history, or creates or pushes anything on GitHub without asking, and running it twice changes nothing. Installing it runs no install scripts.

Every step in detail: [what setup does](docs/what-setup-does.md).

## For AI agents

You've been asked to set up temple-bar. Follow these steps exactly.

1. **For a new project, scaffold it first.** Ask the user what they want to build, and which framework if it matters to them. Scaffold with that framework's tool, using its pnpm option, in the folder itself rather than a subfolder, or create the files by hand. Never run a scaffolder after setup: it can delete or replace what setup writes. In an existing project, skip this step. If it installs with npm, Yarn or Bun, setup refuses it and says how to switch it to pnpm: **ask the user** before making that switch.
2. Run `pnpm create @londontypescript/temple-bar@latest` in the repo root. If the folder has no git repo yet, run `git init` first.
3. If setup reports something missing (`gh` not installed or not signed in, no GitHub remote), **stop and tell the user** exactly what it said. Don't install tools globally and don't work around it.
4. If setup asks to create a GitHub repository or change GitHub settings, **ask the user**, showing them what setup printed. A new repository is public and owned by a GitHub organisation: ask which organisation, and show them the commit identities setup lists, since its first push makes those names and emails public. Only if they say yes, run the command setup printed (`--create-repo --owner <organisation> --identities <code>` for a new repository, `--create-ruleset` for GitHub's protection). Never pass a flag, or pick an organisation, on their behalf.
5. Don't install the package on its own (`pnpm add -D …`). That leaves the repo unprotected.
6. Set the gate's four scripts in `package.json`, `typecheck`, `lint`, `format:check` and `test`, to the right commands for what's in the folder: the framework's own type checker, linter, formatter and test runner where it has them. Never a command that does nothing (`true`, `echo ok`): the gate fails those. If the project has no tool for one of them yet, ask the user which to add. In a workspace, every package needs the four scripts too: the gate runs them in each package's folder.
7. When setup finishes, `main` refuses direct commits, so land the setup and the scripts through a pull request, as setup's output describes. Then read `AGENTS.md` and follow it: write a plan, and don't write code before the user approves it.

## Built for London TypeScript

Temple Bar is the foundation every repository in the [London TypeScript](https://github.com/londontypescript) organisation is built on: our meetup's websites, tools and experiments are all developed by AI agents working under these rules. It's public, and you're welcome to use it, but it's shaped around how we work rather than configured for everyone's. Its decisions, and the reasons for them, are in [docs/adr/](docs/adr/README.md).

## Why "Temple Bar"

Our repositories are named after pieces of London infrastructure whose physical job mirrors what the software does.

Temple Bar is the ceremonial gateway into the City of London. By tradition, even the monarch stops there and asks permission to enter. It stands beside the Inns of Court and the Royal Courts of Justice, and "the Bar" is also the name of the barristers' profession. So: a gate that nothing passes without permission, written rules that are actually enforced, and "passing the bar" as meeting the standard. (The name itself comes from the Knights Templar's land and a road barrier. The legal connection is by location.)

## Contributing

The plans, issues and decisions are all public, so feel free to look around. Contributors will be invited in once the platforms are ready.

## Licence

[MIT](LICENSE)
