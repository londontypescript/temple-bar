# temple-bar

> **Pre-release.** Nothing is published to npm yet. This README describes how temple-bar will work once `0.x` is out; the setup commands below won't run until then. Progress: [docs/plans/temple-bar.md](docs/plans/temple-bar.md).

## Prose != Enforcement

**Rules for AI coding agents that git actually enforces.**

AI coding agents follow written rules most of the time, then drift. After a long session, a context reset or a usage-limit pause, the agent that carefully used branches for six phases commits straight to `main` in the seventh. Nothing noticed, because the rule was only ever words in a file.

temple-bar turns those words into mechanisms. Git hooks refuse the commit, a deterministic quality gate refuses the merge, and GitHub refuses the push. The model's judgement is never what enforces a rule: a script is, and it gives the same answer every time.

### A deterministic workflow around a non-deterministic agent

An agent's output will never be deterministic: ask twice and you get two different answers. The workflow around it can be. temple-bar fixes the parts that must not vary and leaves the agent free inside them:

- **The same path every time.** Plan, approve, branch, commit, gate, pull request, merge. The steps don't depend on which agent is running, how long the session has been, or what it remembers.
- **The same verdict every time.** The gate runs the full suite on every merge, whatever changed. The same code always gets the same answer, locally and in CI.
- **The same limits every time.** What an agent may never do (commit to `main`, merge its own work, weaken a check to make it pass) is refused by a mechanism, not left to the agent to remember.

The agent decides _how_ to build something. temple-bar decides _what counts as done_, and makes that the same on every run.

Where a rule _can't_ be enforced by a script, temple-bar says so. Every rule is labelled with how strongly it's actually held:

| Strength       | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| **Blocked**    | A hook, the gate or GitHub refuses it outright.                       |
| **Detected**   | Something notices afterwards and says so.                             |
| **Prompted**   | You're asked at the right moment; nothing checks the answer.          |
| **Prose only** | Written down, and nothing more. The weakest kind, and listed as such. |

Every rule in temple-bar exists because something went wrong in a real project. When a rule is found to be prose-only and still being broken, the fix is a script, not stronger wording.

### Getting better from real incidents

> **In progress.** This part is still being designed. The outline below is the intent, not a finished feature.

temple-bar is meant to improve from the projects that use it:

1. **Capture.** When something goes wrong during a project, your agent proposes an incident. **You** decide which ones to keep. The record is yours, not the agent's.
2. **Report upstream.** Kept incidents that are about temple-bar itself get reported to this repository, with private project details left out.
3. **Fix and release.** The fix lands here, through the same gate as everything else, and the release notes name the incidents it fixes.
4. **Upgrade.** Your projects pick up the fix by upgrading the package, instead of each project patching its own copy.

Every rule in this repository started as an incident, and new ones will arrive the same way.

## Built for London TypeScript

temple-bar is the foundation every repository in the [London TypeScript](https://github.com/londontypescript) organisation is built on: our meetup's websites, tools and experiments are all developed by AI agents working under these rules. It's public, and you're welcome to use it, but it's shaped around how we work rather than configured for everyone's.

## Why "Temple Bar"

Our repositories are named after pieces of London infrastructure whose physical job mirrors what the software does.

Temple Bar is the ceremonial gateway into the City of London. By tradition, even the monarch stops there and asks permission to enter. It stands beside the Inns of Court and the Royal Courts of Justice, and "the Bar" is also the name of the barristers' profession. So: a gate that nothing passes without permission, written rules that are actually enforced, and "passing the bar" as meeting the standard. (The name itself comes from the Knights Templar's land and a road barrier. The legal connection is by location.)

---

> **temple-bar is a highly opinionated workflow for building software with AI coding agents.**
> It assumes one way of working and enforces it. You need:
>
> - a **GitHub** repository (other hosts aren't supported)
> - the **GitHub CLI** (`gh`), installed and signed in (`gh auth login`). Your agent can't install this for you.
> - **Node.js** 24 or newer, and **git**
>
> Every change reaches `main` through a pull request. Setup stops and tells you what's missing if any of these aren't in place.

## Getting started

Tell your coding agent. Copy one of these into whichever agent you use.

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
3. Your agent asks you what you're building, then writes a **plan**, including which framework to use if you're starting fresh. Nothing is built until you approve it.
4. From then on, work happens on branches, every change passes the gate, and you approve every merge to `main`.

### Cloned a repo that already uses temple-bar?

Nothing to do. `pnpm install` (or `npm install`) switches the hooks on automatically.

## Doing it yourself

If you'd rather run setup by hand:

```bash
mkdir my-app
cd my-app
git init
npm create @londontypescript/temple-bar@latest
```

The same command works with every package manager: `pnpm create …`, `yarn create …`, `bun create …`. In an existing project, run just the last line.

Already ran `npm install -D @londontypescript/temple-bar`? Installing the package on its own doesn't set anything up. Finish with `npx temple-bar init`.

## What setup does

- Checks the requirements: a git repo, `gh` signed in, and `origin` pointing at GitHub. If one is missing, it stops with the exact fix, or offers `gh repo create` and waits for your yes.
- Offers to switch on `main`'s protection rules on GitHub (pull request required, CI required, no direct pushes) if you're an admin of the repo. Otherwise it prints the settings to switch on.
- Adds `@londontypescript/temple-bar` as a dev dependency with your package manager, creating `package.json` if there isn't one.
- Writes `AGENTS.md` (the rules) and `temple-bar.config.json`.
- Installs the git hooks, and adds a `prepare` script so they come back on every install.
- Adds a `gate` script: `npm run gate` is the merge check.
- Guards local `main`: it can only move to commits that are already on GitHub's `main`.
- **Never** deletes files, rewrites history or pushes, and never creates anything on GitHub without asking. Running it twice changes nothing.

temple-bar has no install scripts: installing it never changes your repo by itself.

## For AI agents

You've been asked to set up temple-bar. Follow these steps exactly.

1. Run `npm create @londontypescript/temple-bar@latest` in the repo root. In a pnpm, yarn or bun repo, use that tool's `create` command instead. If the folder has no git repo yet, run `git init` first.
2. If setup reports something missing (`gh` not installed or not signed in, no GitHub remote), **stop and tell the user** exactly what it said. Don't install tools globally and don't work around it.
3. If setup asks to create a GitHub repository or change GitHub settings, **ask the user** and pass on their answer. Never answer yes on their behalf.
4. Don't install the package on its own (`npm install -D …`). That leaves the repo unprotected.
5. When setup finishes, read `AGENTS.md` and follow it. For a new project, start by asking the user what they want to build. Then write a plan, and don't scaffold a framework or write code before the user approves it.

## Licence

[MIT](LICENSE)
