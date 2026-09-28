import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitSeam } from "./git.ts";

function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-git-seam-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

void test("git seam: a successful command returns exit code 0 and stdout", async () => {
  const dir = makeTempRepo();
  try {
    const git = createGitSeam();
    const result = await git.run(["rev-parse", "--is-inside-work-tree"], dir);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), "true");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("git seam: a failing command returns a non-zero exit code and stderr, and never throws", async () => {
  const dir = makeTempRepo();
  try {
    const git = createGitSeam();
    const result = await git.run(["show", "does-not-exist"], dir);
    assert.notEqual(result.code, 0);
    assert.notEqual(result.code, null);
    assert.match(result.stderr, /does-not-exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
