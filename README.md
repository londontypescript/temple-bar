# temple-bar

**temple-bar makes AI coding agents follow your workflow, by enforcing it instead of trusting them to remember it.** Git hooks refuse commits to `main`, a quality gate refuses changes that fail their checks, and GitHub only accepts changes through pull requests.

It exists because agents drift: after a long session or a context reset, the agent that used branches all day commits straight to `main`. It's built for TypeScript projects on GitHub using pnpm, and it's the foundation of every [London TypeScript](https://github.com/londontypescript) repository.

> **Pre-release.** Setup, the git hooks and the gate work today; more is on the way. Progress: [GitHub issues](https://github.com/londontypescript/temple-bar/issues).

## You need

- a **GitHub** repository (other hosts aren't supported)
- the **GitHub CLI** (`gh`), installed and signed in (`gh auth login`). Your agent can't install this for you.
- **Node.js** 24 or newer, and **git**
- **pnpm**, the only supported package manager (npm, yarn and bun aren't supported). Don't have it? See [pnpm's install guide](https://pnpm.io/installation): it's one command.

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

1. Your agent runs temple-bar's setup. If the folder isn't on GitHub yet, **it asks you** before creating the repository.
2. Setup writes the rules (`AGENTS.md`), installs the git hooks and asks whether to switch on `main`'s protection on GitHub.
3. Your agent asks you what you're building, then writes a **plan**. Nothing is built until you approve it.
4. From then on, work happens on branches, every change passes the gate, and you approve every merge to `main`.

### Cloned a repo that already uses temple-bar?

Nothing to do: `pnpm install` switches the hooks on. A fresh clone has no hooks until you install.

### Doing it yourself

```bash
mkdir my-app
cd my-app
git init
pnpm create @londontypescript/temple-bar@latest
```

In an existing project, run just the last line. Every command takes `--help`, which shows the usage and changes nothing.

## For AI agents

You've been asked to set up temple-bar. Follow these steps exactly.

1. Run `pnpm create @londontypescript/temple-bar@latest` in the repo root. If the folder has no git repo yet, run `git init` first.
2. If setup reports something missing (`gh` not installed or not signed in, no GitHub remote), **stop and tell the user** exactly what it said. Don't install tools globally and don't work around it.
3. If setup asks to create a GitHub repository or change GitHub settings, **ask the user**. Only if they say yes, run setup again with `--create-repo` or `--create-ruleset` (`pnpm create @londontypescript/temple-bar@latest --create-repo`). Never pass a flag on their behalf.
4. Don't install the package on its own (`pnpm add -D …`). That leaves the repo unprotected.
5. When setup finishes, `main` refuses direct commits, so land the setup through a pull request, as setup's output describes. Then read `AGENTS.md` and follow it. For a new project, start by asking the user what they want to build. Then write a plan, and don't scaffold a framework or write code before the user approves it.

## Why: prose isn't enforcement

AI coding agents follow written rules most of the time, then drift. After a long session, a context reset or a usage-limit pause, the agent that carefully used branches for six phases commits straight to `main` in the seventh. Nothing noticed, because the rule was only ever words in a file.

temple-bar turns those words into mechanisms. The model's judgement is never what enforces a rule: a script is, and it gives the same answer every time.

### A deterministic workflow around a non-deterministic agent

An agent's output will never be deterministic: ask twice and you get two different answers. The workflow around it can be. temple-bar fixes the parts that must not vary and leaves the agent free inside them:

- **The same path every time.** Plan, approve, branch, commit, gate, pull request, merge. The steps don't depend on which agent is running, how long the session has been, or what it remembers.
- **The same verdict every time.** The gate runs the full suite on every merge, whatever changed. The same code always gets the same answer, locally and in CI.
- **The same limits every time.** What an agent may never do (commit to `main`, merge its own work, weaken a check to make it pass) is refused by a mechanism, not left to the agent to remember.

The agent decides _how_ to build something. temple-bar decides _what counts as done_, and makes that the same on every run.

### How strongly each rule is held

Where a rule _can't_ be enforced by a script, temple-bar says so. Every rule is labelled with how strongly it's actually held:

| Strength       | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| **Blocked**    | A hook, the gate or GitHub refuses it outright.                       |
| **Detected**   | Something notices afterwards and says so.                             |
| **Prompted**   | You're asked at the right moment; nothing checks the answer.          |
| **Prose only** | Written down, and nothing more. The weakest kind, and listed as such. |

When a rule is found to be prose-only and still being broken, the fix is a script, not stronger wording.

### Getting better from real incidents

> **In progress.** This part is still being designed. The outline below is the intent, not a finished feature.

Every rule in temple-bar exists because something went wrong in a real project, and new ones arrive the same way:

1. **Capture.** When something goes wrong during a project, your agent proposes an incident. **You** decide which ones to keep.
2. **Report upstream.** Kept incidents that are about temple-bar itself are filed as issues on this repository, with private project details left out.
3. **Fix and release.** The fix lands here, through the same gate as everything else, and the release notes name the incidents it fixes.
4. **Upgrade.** Your projects pick up the fix by upgrading the package, instead of each project patching its own copy.

## What setup does

- Checks the requirements: a git repo, `gh` signed in, and `origin` pointing at GitHub. If one is missing, it stops with the exact fix, or offers `gh repo create` and waits for your yes.
- Offers to switch on `main`'s protection rules on GitHub: pull request required, no force-pushes, and `main` can't be deleted. If it can't (for example, you're not an admin of the repo), it prints the settings to switch on by hand. Requiring CI checks isn't part of it yet.
- Writes the judge workflow, `temple-bar-judge.yml` in `.github/workflows/`. A pull request runs its own copy of your CI, so it could weaken that CI and still pass. The judge runs from `main` instead, reads each pull request without running it, and fails one that changes a workflow, the pinned temple-bar or the scripts the gate runs. Once the workflow is on `main`, running setup again offers a second ruleset that requires the judge's check (one yes covers both rulesets when they're created together). Such a change is then yours to review and merge as a repository admin; `temple-bar merge` refuses it.
- In a folder with no commits yet, makes the first commit and creates the GitHub repository, once you say yes.
- Adds `@londontypescript/temple-bar` as a dev dependency, creating `package.json` if there isn't one, and keeps your `package.json` formatting when it adds scripts.
- Writes a sensible `.gitignore` for a TypeScript project (dependencies, build output, logs, `.env` files but not their `.example` templates, OS files, personal harness settings, the `.claude/worktrees/` folder where Claude Code puts its worktrees, and `.temple-bar/`, the local working folder), adding only lines you don't already have. Agents put worktrees wherever their tool does; one inside the repo stays out of your checks only if they follow `.gitignore`. Prettier already does; ESLint needs `includeIgnoreFile` from `eslint/config` in its config, and a test runner should look only in your source folders.
- Writes `AGENTS.md` (the rules) if there isn't one already.
- Installs the git hooks, and adds a `prepare` script so they come back on every install. Installing also sets `pull.ff=only` in the repo's git config, so a pull never creates a merge commit on your default branch.
- Adds a `gate` script: `pnpm gate` is the merge check. It needs `typecheck`, `lint`, `format:check` and `test` scripts, and lists each check with its result.
- Guards your default branch (`main`, `master` or whatever GitHub says): locally it can only move to commits that are already on GitHub.
- Sets up every new worktree, whichever tool runs `git worktree add`: copies your `.env` files in from the main checkout (never over one that's there), names any keys their `.example` templates list that are missing (never printing a value), and runs `pnpm install --frozen-lockfile`.
- **Never** deletes files or rewrites history, and never creates or pushes anything on GitHub without asking. Running it twice changes nothing.

temple-bar has no install scripts: installing it never changes your repo by itself.

## Built for London TypeScript

temple-bar is the foundation every repository in the [London TypeScript](https://github.com/londontypescript) organisation is built on: our meetup's websites, tools and experiments are all developed by AI agents working under these rules. It's public, and you're welcome to use it, but it's shaped around how we work rather than configured for everyone's. The plan and its decisions are in [docs/plans/temple-bar.md](docs/plans/temple-bar.md).

## Why "Temple Bar"

Our repositories are named after pieces of London infrastructure whose physical job mirrors what the software does.

Temple Bar is the ceremonial gateway into the City of London. By tradition, even the monarch stops there and asks permission to enter. It stands beside the Inns of Court and the Royal Courts of Justice, and "the Bar" is also the name of the barristers' profession. So: a gate that nothing passes without permission, written rules that are actually enforced, and "passing the bar" as meeting the standard. (The name itself comes from the Knights Templar's land and a road barrier. The legal connection is by location.)

## Contributing

Contributions are welcome, from London TypeScript members and anyone else. Like every London TypeScript repo, temple-bar is developed with pnpm only: `pnpm install`, then `pnpm check` runs the same gate CI runs. Changes reach `main` through pull requests, and [AGENTS.md](AGENTS.md) holds the rules for people and agents alike.

## Licence

[MIT](LICENSE)
