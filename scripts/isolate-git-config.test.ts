// The suite's git must finish all its work before each command returns:
// background maintenance outliving a commit once recreated a test's deleted
// repository and failed the file. This file runs under the isolation, like
// every test file, so it checks the git the other tests get.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

void test("under the isolation, a commit and a push start no background maintenance", (t) => {
  assert.equal(
    process.env.GIT_CONFIG_NOSYSTEM,
    "1",
    "run with `pnpm test`, which loads scripts/isolate-git-config.ts",
  );
  const dir = mkdtempSync(path.join(tmpdir(), "git-maintenance-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  // GIT_TRACE names every git process a command starts, detached or not.
  const git = (args: string[]) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_TRACE: "1" },
    });
  git(["init", "-q", "--bare", "origin.git"]);
  git(["init", "-q", "--initial-branch=main", "."]);
  git(["remote", "add", "origin", "origin.git"]);
  const commit = git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x",
  ]);
  assert.equal(commit.status, 0, commit.stderr);
  const push = git(["push", "-q", "origin", "main"]);
  assert.equal(push.status, 0, push.stderr);
  for (const [name, run] of [
    ["commit", commit],
    ["push", push],
  ] as const) {
    assert.doesNotMatch(
      run.stderr,
      /run_command: git maintenance run/,
      `${name} started background maintenance`,
    );
  }
});
