// The first merge on a repo that adopts temple-bar, on real git with the
// real hook shims: main has no temple-bar, and the merged branch's worktree
// is the only checkout that does. The hooks that run during cleanup (moving
// main, and the leased push that deletes the remote branch) find temple-bar
// there, and merge keeps that worktree and its branch afterwards.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  markReady,
  runGit,
  runSh,
  writeFakeBin,
} from "../hooks/testing/repo-fixture.ts";
import { createGitSeam } from "../seams/git.ts";
import { createFakeContext } from "../testing/fakes.ts";
import { configureTestRepo } from "../testing/git-repo.ts";
import { cleanUp } from "./local.ts";

void test("first merge: main fast-forwards and the remote branch goes through the real hooks, and the worktree and its branch are kept", async () => {
  const fixture = createHookFixture();
  try {
    const primary = fixture.repoDir;
    alignWithOrigin(fixture);
    fixture.removeBin();
    const worktree = path.join(fixture.root, "setup");
    assert.equal(
      runGit(primary, ["worktree", "add", "-q", "-b", "feat/x", worktree]).code,
      0,
    );

    // What setup does in its worktree: install temple-bar and the hooks.
    const bin = writeFakeBin(worktree);
    const install = runSh(bin, ["hook", "install"], worktree);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    // Setup's commit, whose .gitignore keeps node_modules out of it.
    writeFileSync(path.join(worktree, ".gitignore"), "node_modules\n");
    runGit(worktree, ["add", ".gitignore"]);
    assert.equal(
      runGit(worktree, ["commit", "-q", "-m", "chore: set up"]).code,
      0,
    );
    const tip = markReady(worktree);
    const push = runGit(worktree, ["push", "-q", "origin", "feat/x"]);
    assert.equal(push.code, 0, push.stderr);

    // GitHub's squash merge, and the branch left behind on origin. The bare
    // origin needs an identity of its own: CI runners have none to fall
    // back on, so commit-tree would fail there.
    configureTestRepo(fixture.originDir);
    const commitTree = runGit(fixture.originDir, [
      "commit-tree",
      `${tip}^{tree}`,
      "-p",
      "refs/heads/main",
      "-m",
      "chore: set up (#1)",
    ]);
    assert.equal(commitTree.code, 0, commitTree.stderr);
    const squash = commitTree.stdout.trim();
    const moved = runGit(fixture.originDir, [
      "update-ref",
      "refs/heads/main",
      squash,
    ]);
    assert.equal(moved.code, 0, moved.stderr);

    const ctx = createFakeContext({ git: createGitSeam(), cwd: primary });
    const report = await cleanUp(ctx, {
      primaryPath: primary,
      branch: "feat/x",
      defaultBranch: "main",
      mergedSha: tip,
    });

    assert.deepEqual(report.problems, []);
    assert.equal(
      runGit(primary, ["rev-parse", "main"]).stdout.trim(),
      squash,
      "main fast-forwarded in the primary checkout",
    );
    assert.equal(
      runGit(fixture.originDir, ["branch", "--list", "feat/x"]).stdout,
      "",
      "remote branch gone",
    );
    assert.ok(
      report.done.includes(
        `deleted origin/feat/x, whose tip was still the merged ${tip}`,
      ),
      report.done.join("\n"),
    );
    assert.ok(existsSync(worktree), "the worktree is kept");
    assert.equal(
      runGit(primary, ["rev-parse", "refs/heads/feat/x"]).stdout.trim(),
      tip,
      "the local branch is kept at the merged commit",
    );
    // git names the folder in its own form (a real path, and forward
    // slashes on Windows), so only the folder's name is matched.
    assert.match(
      report.done.join("\n"),
      new RegExp(
        `^kept the worktree at .*setup on feat/x \\(${tip}\\); your harness removes it when it is done, or inspect it with temple-bar leftovers$`,
        "m",
      ),
    );
  } finally {
    fixture.cleanup();
  }
});
