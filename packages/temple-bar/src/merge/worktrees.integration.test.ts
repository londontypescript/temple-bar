// isDirty against a real repo: what counts as work merge must not disturb.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitSeam } from "../seams/git.ts";
import { createFakeContext } from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { isDirty } from "./worktrees.ts";

void test("isDirty: untracked files don't count, a changed tracked file does", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-dirty-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "hello\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "chore: start"], { cwd: dir });
    const ctx = createFakeContext({ git: createGitSeam(), cwd: dir });

    // Like node_modules on main before the setup's .gitignore arrives.
    writeFileSync(path.join(dir, "untracked.txt"), "x\n");
    assert.equal(await isDirty(ctx, dir), false, "untracked only");

    writeFileSync(path.join(dir, "README.md"), "changed\n");
    assert.equal(await isDirty(ctx, dir), true, "tracked file changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
