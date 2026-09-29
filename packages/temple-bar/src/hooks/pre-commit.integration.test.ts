// Integration tests for the pre-commit hook, against a real git repo with
// the real shim (shims.ts) installed via the real command (command.ts),
// spawned exactly like git would spawn it (through `sh`, see
// testing/repo-fixture.ts).

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createHookFixture,
  installRealHooks,
  runGit,
} from "./testing/repo-fixture.ts";

void test("pre-commit: a direct commit on an unborn main is refused, and nothing is committed", () => {
  const fixture = createHookFixture();
  try {
    assert.equal(installRealHooks(fixture).code, 0);

    writeFileSync(path.join(fixture.repoDir, "file.txt"), "hello\n", "utf8");
    runGit(fixture.repoDir, ["add", "file.txt"]);
    const commit = runGit(fixture.repoDir, ["commit", "-m", "first"]);

    assert.notEqual(commit.code, 0);
    assert.match(
      commit.stderr + commit.stdout,
      /refusing to commit directly to main/,
    );

    const log = runGit(fixture.repoDir, ["log", "--oneline"]);
    assert.notEqual(log.code, 0, "main must still be unborn: no commit exists");
  } finally {
    fixture.cleanup();
  }
});

void test("pre-commit: a direct commit on an existing main is refused", () => {
  const fixture = createHookFixture();
  try {
    // Commit once before installing, to get main past "unborn".
    writeFileSync(path.join(fixture.repoDir, "a.txt"), "a\n", "utf8");
    runGit(fixture.repoDir, ["add", "a.txt"]);
    assert.equal(runGit(fixture.repoDir, ["commit", "-m", "a"]).code, 0);
    const before = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();

    assert.equal(installRealHooks(fixture).code, 0);

    writeFileSync(path.join(fixture.repoDir, "b.txt"), "b\n", "utf8");
    runGit(fixture.repoDir, ["add", "b.txt"]);
    const commit = runGit(fixture.repoDir, ["commit", "-m", "b"]);

    assert.notEqual(commit.code, 0);
    assert.match(
      commit.stderr + commit.stdout,
      /refusing to commit directly to main/,
    );
    const after = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(after, before, "HEAD must not have moved");
  } finally {
    fixture.cleanup();
  }
});

void test("pre-commit: a commit on a feature branch is allowed", () => {
  const fixture = createHookFixture();
  try {
    writeFileSync(path.join(fixture.repoDir, "a.txt"), "a\n", "utf8");
    runGit(fixture.repoDir, ["add", "a.txt"]);
    assert.equal(runGit(fixture.repoDir, ["commit", "-m", "a"]).code, 0);

    assert.equal(installRealHooks(fixture).code, 0);

    runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "c.txt"), "c\n", "utf8");
    runGit(fixture.repoDir, ["add", "c.txt"]);
    const commit = runGit(fixture.repoDir, ["commit", "-m", "c"]);

    assert.equal(commit.code, 0);
  } finally {
    fixture.cleanup();
  }
});
