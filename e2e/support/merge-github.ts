// A stand-in GitHub for the packed `temple-bar merge`, and a set-up project
// to merge in: a pnpm workspace that setup has run in, whose work is the
// default branch of a bare "GitHub" repository.
//
// The launcher's environment already puts a copy of Node named `gh` on PATH
// and preloads setup's fake into every Node process; this preload goes
// first, so it answers every `gh` call from here on, and does nothing in any
// other process. It reads the pull request's head from the bare repository
// and squash-merges into it the way GitHub would, keeping the head it
// accepted in a state file so later calls see the pull request as merged at
// that head. Like `gh pr merge` without --delete-branch, it leaves the
// branch on origin. Node resolves the first argument to an absolute path (it
// takes it for a script), so only its basename is the subcommand.
//
// Each pull request is chosen per run through the environment
// (`pullRequestEnv`), so one project can merge several. A test can also
// name git commands to run the moment GitHub has accepted the squash, before
// merge's cleanup runs, to make a push or a commit race it.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { launch, makeProject, type PackedLauncher } from "./launcher.ts";
import { describe, run, type RunOptions } from "./run.ts";
import { checkedWorkspace } from "./workspace.ts";

const MERGE_GH = `"use strict";
const path = require("node:path");
if (path.basename(process.execPath).replace(/\\.exe$/i, "") === "gh") {
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const origin = process.env.FAKE_GH_ORIGIN;
  const state = process.env.FAKE_GH_STATE;
  const number = Number(process.env.FAKE_GH_NUMBER || "7");
  const branch = process.env.FAKE_GH_BRANCH || "feat/x";
  const title = process.env.FAKE_GH_TITLE || "docs: add x";
  const args = [path.basename(process.argv[1] || ""), ...process.argv.slice(2)];
  const joined = args.join(" ");
  const git = (...rest) =>
    execFileSync("git", ["--git-dir", origin, ...rest], { encoding: "utf8" }).trim();
  const merged = fs.existsSync(state) ? fs.readFileSync(state, "utf8") : "";
  const answer = (text) => {
    process.stdout.write(text);
    process.exit(0);
  };
  const after = (flag) => args[args.indexOf(flag) + 1] || "";
  if (joined.startsWith("repo view")) {
    answer('{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"main"}}');
  }
  if (joined.startsWith("pr view")) {
    answer(JSON.stringify({
      number,
      title,
      body: "- add x\\n",
      state: merged === "" ? "OPEN" : "MERGED",
      isDraft: false,
      baseRefName: "main",
      headRefName: branch,
      headRefOid: merged === "" ? git("rev-parse", "refs/heads/" + branch) : merged,
      isCrossRepository: false,
    }));
  }
  if (joined.includes("/check-runs")) {
    answer('{"name":"gate","status":"completed","conclusion":"success"}\\n');
  }
  if (joined.startsWith("pr merge")) {
    const head = after("--match-head-commit");
    const message = after("--subject") + "\\n\\n" + after("--body");
    const squash = git("commit-tree", head + "^{tree}", "-p", "refs/heads/main", "-m", message);
    git("update-ref", "refs/heads/main", squash);
    fs.writeFileSync(state, head);
    const race = process.env.FAKE_GH_AFTER_MERGE;
    if (race) {
      for (const step of JSON.parse(fs.readFileSync(race, "utf8"))) {
        execFileSync("git", step.args, { cwd: step.cwd, encoding: "utf8" });
      }
    }
    answer("");
  }
  if (joined.startsWith("pr list")) {
    answer(JSON.stringify(merged === "" ? [] : [
      { number, headRefName: branch, headRefOid: merged, state: "MERGED" },
    ]));
  }
  if (joined.startsWith("issue list")) {
    answer("0");
  }
  // Statuses, workflow runs, required checks, alerts and bypasses: none.
  answer("");
}
`;

export interface MergeProject extends RunOptions {
  /** The bare repository standing in for GitHub. */
  readonly origin: string;
}

/** Runs a command that must succeed and returns its stdout. */
export async function succeed(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<string> {
  const result = await run(command, args, options);
  assert.equal(result.code, 0, describe(result));
  return result.stdout.trim();
}

/** A checked pnpm workspace with temple-bar set up by the packed launcher,
 * the fake GitHub answering for it, and setup's work as origin's main. */
export async function startMergeProject(
  launcher: PackedLauncher,
): Promise<MergeProject> {
  const options = await makeProject(launcher, "workspace", checkedWorkspace());
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  const preload = path.join(launcher.folder, "merge-gh-preload.cjs");
  writeFileSync(preload, MERGE_GH);
  const origin = path.join(launcher.folder, "origin.git");
  const project: MergeProject = {
    cwd: options.cwd,
    origin,
    env: {
      ...options.env,
      // NODE_OPTIONS reads a backslash inside quotes as an escape, which
      // would eat every separator in a Windows path; Node takes forward
      // slashes.
      NODE_OPTIONS:
        `--require "${preload.replaceAll("\\", "/")}" ${options.env.NODE_OPTIONS ?? ""}`.trim(),
      FAKE_GH_ORIGIN: origin,
      FAKE_GH_STATE: path.join(launcher.folder, "merged-head"),
    },
  };

  // Setup's work becomes the default branch on "GitHub": committed on a
  // branch (the hooks refuse commits to main), fetched into the bare
  // repository as main, and fast-forwarded into the local main.
  const git = (...args: string[]) => succeed("git", args, project);
  await git("switch", "-q", "-c", "setup");
  await git("add", "-A");
  await git("commit", "-q", "-m", "chore: set up temple-bar");
  await succeed(
    "git",
    ["init", "-q", "--bare", "--initial-branch=main", origin],
    {
      ...project,
      cwd: launcher.folder,
    },
  );
  await git(
    "--git-dir",
    origin,
    "fetch",
    "-q",
    project.cwd,
    "refs/heads/setup:refs/heads/main",
  );
  await git("remote", "set-url", "origin", origin);
  await git("fetch", "-q", "origin");
  await git("switch", "-q", "main");
  await git("merge", "-q", "--ff-only", "origin/main");
  await git("branch", "-q", "-d", "setup");
  return project;
}

/** A git command the fake GitHub runs once it has accepted the squash. */
export interface RaceStep {
  readonly cwd: string;
  readonly args: readonly string[];
}

/** The project's options for merging one pull request: its number and
 * branch, a state file of its own, and any race to run once GitHub has
 * accepted it. */
export function pullRequestEnv(
  project: MergeProject,
  folder: string,
  pullRequest: {
    readonly number: number;
    readonly branch: string;
    readonly title: string;
    readonly race?: readonly RaceStep[];
  },
): RunOptions {
  const name = `pr-${String(pullRequest.number)}`;
  const env: NodeJS.ProcessEnv = {
    ...project.env,
    FAKE_GH_NUMBER: String(pullRequest.number),
    FAKE_GH_BRANCH: pullRequest.branch,
    FAKE_GH_TITLE: pullRequest.title,
    FAKE_GH_STATE: path.join(folder, `${name}-merged-head`),
  };
  if (pullRequest.race !== undefined) {
    const race = path.join(folder, `${name}-race.json`);
    writeFileSync(race, JSON.stringify(pullRequest.race));
    env.FAKE_GH_AFTER_MERGE = race;
  }
  return { cwd: project.cwd, env };
}
