// The first merge on a repo that adopts temple-bar, on real git with the
// real hook shims: main has no temple-bar, and the merged branch's worktree
// is the only checkout that does. cleanUp must do everything that runs a
// hook before it removes that worktree.

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
import { cleanUp } from "./local.ts";

void test("first merge: main fast-forwards and the remote branch goes while the worktree's temple-bar still exists", async () => {
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
    // Setup's .gitignore keeps node_modules from blocking the removal.
    writeFileSync(path.join(worktree, ".gitignore"), "node_modules\n");
    runGit(worktree, ["add", ".gitignore"]);
    assert.equal(
      runGit(worktree, ["commit", "-q", "-m", "chore: set up"]).code,
      0,
    );
    const tip = markReady(worktree);
    const push = runGit(worktree, ["push", "-q", "origin", "feat/x"]);
    assert.equal(push.code, 0, push.stderr);

    // GitHub's squash merge, and the branch left behind on origin.
    const squash = runGit(fixture.originDir, [
      "commit-tree",
      `${tip}^{tree}`,
      "-p",
      "refs/heads/main",
      "-m",
      "chore: set up (#1)",
    ]).stdout.trim();
    runGit(fixture.originDir, ["update-ref", "refs/heads/main", squash]);

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
    assert.equal(existsSync(worktree), false, "worktree removed");
    assert.equal(
      runGit(primary, ["branch", "--list", "feat/x"]).stdout,
      "",
      "local branch gone",
    );
  } finally {
    fixture.cleanup();
  }
});
