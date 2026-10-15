// The packed `temple-bar merge` in a pnpm workspace, with real pnpm and real
// git: only GitHub is faked. Merge runs the full gate in-process on a branch
// it brings up to date, and in a workspace the gate lists the packages
// through the pnpm that started it (npm_execpath). Started by
// `pnpm exec temple-bar merge` it has no such pnpm and refuses; started by
// the root `merge` script setup writes, as `pnpm merge <N>` from the
// default-branch checkout, the gate lists both packages and the merge lands.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  launch,
  makeProject,
  startPackedLauncher,
  type PackedLauncher,
} from "./support/launcher.ts";
import { describe, run, type RunOptions } from "./support/run.ts";
import { checkedWorkspace } from "./support/workspace.ts";

// A stand-in `gh` for merge's calls. The launcher's environment already
// puts a copy of Node named `gh` on PATH and preloads setup's fake into
// every Node process; this preload goes first, so it answers every `gh`
// call from here on, and does nothing in any other process. It reads the
// pull request's head from the bare "GitHub" repository and squash-merges
// into it the way GitHub would, keeping the merged head in a state file so
// later calls see the pull request as merged. Node resolves the first
// argument to an absolute path (it takes it for a script), so only its
// basename is the subcommand.
const MERGE_GH = `"use strict";
const path = require("node:path");
if (path.basename(process.execPath).replace(/\\.exe$/i, "") === "gh") {
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const origin = process.env.FAKE_GH_ORIGIN;
  const state = process.env.FAKE_GH_STATE;
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
      number: 7,
      title: "docs: add x",
      body: "- add x\\n",
      state: merged === "" ? "OPEN" : "MERGED",
      isDraft: false,
      baseRefName: "main",
      headRefName: "feat/x",
      headRefOid: merged === "" ? git("rev-parse", "refs/heads/feat/x") : merged,
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
    answer("");
  }
  if (joined.startsWith("pr list")) {
    answer(JSON.stringify(merged === "" ? [] : [
      { number: 7, headRefName: "feat/x", headRefOid: merged, state: "MERGED" },
    ]));
  }
  if (joined.startsWith("issue list")) {
    answer("0");
  }
  // Statuses, workflow runs, required checks, alerts and bypasses: none.
  answer("");
}
`;

let launcher: PackedLauncher | undefined;
let project: RunOptions | undefined;

before(async () => {
  launcher = await startPackedLauncher("temple-bar-workspace-merge-");
  const options = await makeProject(launcher, "workspace", checkedWorkspace());
  const setup = await launch(launcher, options);
  assert.equal(setup.code, 0, describe(setup));
  const preload = path.join(launcher.folder, "merge-gh-preload.cjs");
  writeFileSync(preload, MERGE_GH);
  // NODE_OPTIONS reads a backslash inside quotes as an escape, which would
  // eat every separator in a Windows path; Node takes forward slashes.
  const env = {
    ...options.env,
    NODE_OPTIONS:
      `--require "${preload.replaceAll("\\", "/")}" ${options.env.NODE_OPTIONS ?? ""}`.trim(),
    FAKE_GH_ORIGIN: path.join(launcher.folder, "origin.git"),
    FAKE_GH_STATE: path.join(launcher.folder, "merged-head"),
  };
  project = { cwd: options.cwd, env };
});

after(async () => {
  await launcher?.close();
});

function inProject(): RunOptions {
  assert.ok(project, "the workspace was not set up");
  return project;
}

function folder(): string {
  assert.ok(launcher, "the launcher did not start");
  return launcher.folder;
}

/** Runs a command that must succeed, in `cwd`, and returns its stdout. */
async function ok(
  command: string,
  args: readonly string[],
  cwd = inProject().cwd,
): Promise<string> {
  const result = await run(command, args, { ...inProject(), cwd });
  assert.equal(result.code, 0, describe(result));
  return result.stdout.trim();
}

void test(
  "workspace merge: pnpm merge from the default-branch checkout merges a behind branch, and the gate lists the packages",
  { timeout: 600_000 },
  async () => {
    const origin = path.join(folder(), "origin.git");
    const worktree = path.join(folder(), "wt-x");
    const seed = path.join(folder(), "seed");

    // Setup's work becomes the default branch on "GitHub": committed on a
    // branch (the hooks refuse commits to main), fetched into the bare
    // repository as main, and fast-forwarded into the local main.
    await ok("git", ["switch", "-q", "-c", "setup"]);
    await ok("git", ["add", "-A"]);
    await ok("git", ["commit", "-q", "-m", "chore: set up temple-bar"]);
    await ok(
      "git",
      ["init", "-q", "--bare", "--initial-branch=main", origin],
      folder(),
    );
    await ok("git", [
      "--git-dir",
      origin,
      "fetch",
      "-q",
      inProject().cwd,
      "refs/heads/setup:refs/heads/main",
    ]);
    await ok("git", ["remote", "set-url", "origin", origin]);
    await ok("git", ["fetch", "-q", "origin"]);
    await ok("git", ["switch", "-q", "main"]);
    await ok("git", ["merge", "-q", "--ff-only", "origin/main"]);
    await ok("git", ["branch", "-q", "-d", "setup"]);
    const manifest = JSON.parse(
      await ok("git", ["show", "main:package.json"]),
    ) as { scripts?: Record<string, string> };
    assert.equal(manifest.scripts?.merge, "temple-bar merge");

    // The pull request's branch, in its own worktree (the post-checkout hook
    // installs it), marked ready and pushed.
    await ok("git", [
      "worktree",
      "add",
      "-q",
      "-b",
      "feat/x",
      worktree,
      "main",
    ]);
    writeFileSync(path.join(worktree, "x.md"), "# X\n");
    await ok("git", ["add", "x.md"], worktree);
    await ok("git", ["commit", "-q", "-m", "docs: add x"], worktree);
    await ok("pnpm", ["ready"], worktree);
    await ok("git", ["push", "-q", "-u", "origin", "feat/x"], worktree);
    const pushedTip = await ok("git", ["rev-parse", "HEAD"], worktree);

    // The default branch moves on, so the pull request's branch is behind.
    await ok("git", ["clone", "-q", origin, seed], folder());
    writeFileSync(path.join(seed, "y.md"), "# Y\n");
    await ok("git", ["add", "y.md"], seed);
    await ok("git", ["commit", "-q", "-m", "docs: add y"], seed);
    await ok("git", ["push", "-q", "origin", "main"], seed);

    // The control: started without pnpm, the gate inside merge can't list
    // the workspace's packages, so merge refuses and pushes nothing. Its
    // merge commit stays in the worktree, so the branch goes back to what
    // was pushed.
    const exec = await run(
      "pnpm",
      ["exec", "temple-bar", "merge", "7"],
      inProject(),
    );
    assert.equal(exec.code, 1, describe(exec));
    assert.match(exec.stderr, /the gate wasn't started through pnpm/);
    assert.match(
      exec.stderr,
      /`pnpm merge <N>` from the default-branch checkout/,
    );
    assert.match(
      exec.stderr,
      /^merge: refused: with origin\/main merged in, feat\/x fails the gate/m,
    );
    assert.equal(
      await ok("git", ["--git-dir", origin, "rev-parse", "refs/heads/feat/x"]),
      pushedTip,
    );
    await ok("git", ["reset", "-q", "--hard", pushedTip], worktree);

    const merge = await run("pnpm", ["merge", "7"], inProject());
    assert.equal(merge.code, 0, describe(merge));
    assert.match(
      merge.stdout,
      /^ {2}passed {3}workspace packages \(the root and 2 package\(s\)\)$/m,
    );
    assert.match(merge.stdout, /^ {2}passed {3}lint \(packages\/b\)$/m);
    assert.match(merge.stdout, /^merge: merged #7 as "docs: add x \(#7\)"$/m);
    assert.equal(
      await ok("git", [
        "--git-dir",
        origin,
        "log",
        "-1",
        "--format=%s",
        "main",
      ]),
      "docs: add x (#7)",
    );
    assert.equal(existsSync(worktree), false, "the worktree is removed");
    assert.equal(
      await ok("git", ["rev-parse", "main"]),
      await ok("git", ["--git-dir", origin, "rev-parse", "main"]),
      "main fast-forwarded",
    );
  },
);
