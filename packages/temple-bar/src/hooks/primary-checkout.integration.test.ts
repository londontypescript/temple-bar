// Integration tests for the main checkout's warning in real temp repos: the
// real post-checkout shim from the shared git folder, the real CLI from
// source, real `git switch` and `git worktree add`.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  installRealHooks,
  runGit,
  type CommandResult,
  type HookFixture,
} from "./testing/repo-fixture.ts";

const WARNING = /temple-bar: warning: the main checkout at /;

function repoOn(branch = "main"): HookFixture {
  const fixture = createHookFixture({ branch });
  alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  return fixture;
}

function output(result: CommandResult): string {
  return result.stdout + result.stderr;
}

void test("main checkout: switching to a branch warns, and the switch still happens", () => {
  const fixture = repoOn();
  try {
    const result = runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);

    assert.equal(result.code, 0, output(result));
    assert.match(result.stderr, WARNING);
    assert.match(result.stderr, /is on the branch feature, not main\./);
    assert.equal(
      runGit(fixture.repoDir, ["branch", "--show-current"]).stdout.trim(),
      "feature",
    );
  } finally {
    fixture.cleanup();
  }
});

void test("main checkout: switching back to main says nothing", () => {
  const fixture = repoOn();
  try {
    runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);

    const result = runGit(fixture.repoDir, ["switch", "-q", "main"]);

    assert.equal(result.code, 0, output(result));
    assert.doesNotMatch(output(result), /temple-bar/);
  } finally {
    fixture.cleanup();
  }
});

void test("main checkout: a detached HEAD warns", () => {
  const fixture = repoOn();
  try {
    const result = runGit(fixture.repoDir, ["switch", "-q", "--detach"]);

    assert.equal(result.code, 0, output(result));
    assert.match(result.stderr, /is on a detached HEAD, not main\./);
  } finally {
    fixture.cleanup();
  }
});

void test("main checkout: where origin's default is master, main is the branch that warns", () => {
  const fixture = repoOn("master");
  try {
    const result = runGit(fixture.repoDir, ["switch", "-q", "-c", "main"]);

    assert.equal(result.code, 0, output(result));
    assert.match(result.stderr, /is on the branch main, not master\./);
  } finally {
    fixture.cleanup();
  }
});

void test("linked worktree: on a branch or detached, it never warns", () => {
  const fixture = repoOn();
  try {
    const worktree = path.join(fixture.root, "feature");

    const added = runGit(fixture.repoDir, [
      "worktree",
      "add",
      "-q",
      "-b",
      "feature",
      worktree,
    ]);
    const switched = runGit(worktree, ["switch", "-q", "-c", "other"]);
    const detached = runGit(worktree, ["switch", "-q", "--detach"]);

    for (const result of [added, switched, detached]) {
      assert.equal(result.code, 0, output(result));
      assert.doesNotMatch(output(result), WARNING);
    }
  } finally {
    fixture.cleanup();
  }
});

void test("main checkout: with temple-bar installed nowhere, a switch is quiet rather than refused", () => {
  const fixture = repoOn();
  try {
    fixture.removeBin();

    const result = runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);

    assert.equal(result.code, 0, output(result));
    assert.doesNotMatch(output(result), /temple-bar/);
  } finally {
    fixture.cleanup();
  }
});
