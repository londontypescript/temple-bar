// End to end for the commit-msg hook: a real git repo with the real shim
// installed, committing through git itself, so what is exercised is the path
// a developer takes, not just the checking function.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createHookFixture,
  installRealHooks,
  runGit,
  type HookFixture,
} from "./testing/repo-fixture.ts";

// Commits happen on a feature branch so the pre-commit hook has no say: a
// refusal in these tests can only come from commit-msg.
function setUp(): HookFixture {
  const fixture = createHookFixture();
  assert.equal(installRealHooks(fixture).code, 0);
  runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(path.join(fixture.repoDir, "a.txt"), "a\n", "utf8");
  runGit(fixture.repoDir, ["add", "a.txt"]);
  return fixture;
}

void test("commit-msg: a commit without a prefix is refused by the hook, and nothing is committed", () => {
  const fixture = setUp();
  try {
    const commit = runGit(fixture.repoDir, ["commit", "-m", "add a file"]);

    // The message comes first so a break shows the hook's own refusal missing,
    // not just a commit that happened to succeed or fail.
    assert.match(
      commit.stderr,
      /the commit subject needs a conventional prefix: add a file/,
    );
    assert.match(commit.stderr, /feat, fix, docs, chore/);
    assert.notEqual(commit.code, 0);
    assert.notEqual(runGit(fixture.repoDir, ["log"]).code, 0);
  } finally {
    fixture.cleanup();
  }
});

void test("commit-msg: a conventional commit is accepted", () => {
  const fixture = setUp();
  try {
    const commit = runGit(fixture.repoDir, [
      "commit",
      "-m",
      "feat(files): add a file",
    ]);

    assert.equal(commit.code, 0, commit.stderr);
    assert.match(
      runGit(fixture.repoDir, ["log", "-1", "--format=%s"]).stdout,
      /^feat\(files\): add a file/,
    );
  } finally {
    fixture.cleanup();
  }
});

void test("commit-msg: a merge commit git generates is not blocked", () => {
  const fixture = setUp();
  try {
    assert.equal(
      runGit(fixture.repoDir, ["commit", "-m", "feat: first"]).code,
      0,
    );
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "other"]);
    writeFileSync(path.join(fixture.repoDir, "b.txt"), "b\n", "utf8");
    runGit(fixture.repoDir, ["add", "b.txt"]);
    assert.equal(
      runGit(fixture.repoDir, ["commit", "-m", "fix: second"]).code,
      0,
    );
    runGit(fixture.repoDir, ["checkout", "-q", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "c.txt"), "c\n", "utf8");
    runGit(fixture.repoDir, ["add", "c.txt"]);
    assert.equal(
      runGit(fixture.repoDir, ["commit", "-m", "docs: third"]).code,
      0,
    );

    const merge = runGit(fixture.repoDir, ["merge", "--no-ff", "other"]);

    assert.equal(merge.code, 0, merge.stderr + merge.stdout);
    assert.match(
      runGit(fixture.repoDir, ["log", "-1", "--format=%s"]).stdout,
      /^Merge /,
    );
  } finally {
    fixture.cleanup();
  }
});
