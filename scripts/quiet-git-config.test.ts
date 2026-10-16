// The suite's git must finish all its work before each command returns:
// background maintenance outliving a commit once recreated a test's deleted
// repository and failed the file. Checked in both environments tests give
// git: the suite's own isolation (this file runs under it, like every test
// file) and the one the end-to-end launcher and the scaffold check build.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { environments } from "./scaffold-check/environment.ts";

/** Commits and pushes in a new repository under `env`, and fails if git
 * started its maintenance for either. */
function assertNoMaintenance(dir: string, env: NodeJS.ProcessEnv): void {
  // GIT_TRACE names every git process a command starts, detached or not.
  const git = (args: string[]) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...env, GIT_TRACE: "1" },
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
  // Pushing to a repository on disk runs its receive-pack here, which starts
  // maintenance of its own in the origin.
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
}

function tempDir(t: TestContext, name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), name));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("under the suite's isolation, a commit and a push start no background maintenance", (t) => {
  assert.equal(
    process.env.GIT_CONFIG_NOSYSTEM,
    "1",
    "run with `pnpm test`, which loads scripts/isolate-git-config.ts",
  );
  assertNoMaintenance(tempDir(t, "git-maintenance-"), process.env);
});

void test("under the launcher's environment, a commit and a push start no background maintenance", (t) => {
  const folder = tempDir(t, "git-maintenance-env-");
  const { setup } = environments(folder, process.env, "http://127.0.0.1:9");
  const repo = path.join(folder, "repo");
  mkdirSync(repo);
  assertNoMaintenance(repo, setup);
});
