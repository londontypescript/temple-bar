// End to end for the pre-push hook: a real repo with the real shim installed
// and a bare "origin", pushing through git itself.
//
// A rewrite is pushed with `--force`, which git's own check would allow, so
// a refusal in these tests can only be the hook's.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  installRealHooks,
  markReady,
  pushToOriginMain,
  runGit,
  type CommandResult,
  type HookFixture,
} from "./testing/repo-fixture.ts";

/** Marks the current commit ready, as a passing `temple-bar ready` does,
 * then pushes the feature branch. */
function pushReady(fixture: HookFixture): CommandResult {
  markReady(fixture.repoDir);
  return runGit(fixture.repoDir, ["push", "origin", "feature"]);
}

function commitFile(fixture: HookFixture, name: string, lines = 1): void {
  const content = Array.from(
    { length: lines },
    (_, i) => `line ${String(i)}\n`,
  ).join("");
  writeFileSync(path.join(fixture.repoDir, name), content, "utf8");
  assert.equal(runGit(fixture.repoDir, ["add", name]).code, 0);
  const commit = runGit(fixture.repoDir, [
    "commit",
    "-q",
    "-m",
    `feat: add ${name}`,
  ]);
  assert.equal(commit.code, 0, commit.stderr);
}

/** A clone aligned with origin, hooks installed, on a new feature branch. */
function setUp(): HookFixture {
  const fixture = createHookFixture();
  alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
  return fixture;
}

void test("pre-push: a first push of a new branch is allowed", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    const push = pushReady(fixture);
    assert.equal(push.code, 0, push.stderr);
    assert.doesNotMatch(push.stderr, /temple-bar:/);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a normal push that adds a commit is allowed", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    assert.equal(pushReady(fixture).code, 0);
    commitFile(fixture, "b.txt");
    const push = pushReady(fixture);
    assert.equal(push.code, 0, push.stderr);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a force push after amending a pushed commit is refused by the hook, and GitHub's copy is untouched", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    assert.equal(pushReady(fixture).code, 0);
    const pushed = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(
      runGit(fixture.repoDir, [
        "commit",
        "-q",
        "--amend",
        "-m",
        "feat: add a.txt, reworded",
      ]).code,
      0,
    );
    // Marked, so the only thing wrong with this push is that it rewrites.
    markReady(fixture.repoDir);

    const push = runGit(fixture.repoDir, [
      "push",
      "--force",
      "origin",
      "feature",
    ]);

    // The hook's own words come first, so a break shows them missing and not
    // only a push that happened to succeed.
    assert.match(push.stderr, /refusing to push feature: .*\(a force push\)/);
    assert.match(
      push.stderr,
      /merging main into it; never rewrite a pushed branch/,
    );
    assert.notEqual(push.code, 0);
    const onOrigin = runGit(fixture.originDir, [
      "rev-parse",
      "refs/heads/feature",
    ]).stdout.trim();
    assert.equal(onOrigin, pushed);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: deleting a pushed branch is allowed", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    assert.equal(pushReady(fixture).code, 0);
    const del = runGit(fixture.repoDir, [
      "push",
      "origin",
      "--delete",
      "feature",
    ]);
    assert.equal(del.code, 0, del.stderr);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: an oversized branch prints the size warning and still pushes", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "big.txt", 600);

    const push = pushReady(fixture);

    assert.match(push.stderr, /warning: this pull request may be too big/);
    assert.match(push.stderr, /600 lines/);
    assert.equal(push.code, 0, push.stderr);
    assert.equal(
      runGit(fixture.originDir, ["rev-parse", "--verify", "refs/heads/feature"])
        .code,
      0,
    );
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a normal-sized branch prints nothing extra", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt", 3);
    const push = pushReady(fixture);
    assert.equal(push.code, 0, push.stderr);
    assert.doesNotMatch(push.stderr, /warning|temple-bar:|pr-size/);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: bringing a pushed branch up to date by merging main into it is allowed", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    assert.equal(pushReady(fixture).code, 0);
    pushToOriginMain(fixture.root, fixture.originDir, "later.txt", "x\n");
    assert.equal(runGit(fixture.repoDir, ["fetch", "-q", "origin"]).code, 0);
    const merge = runGit(fixture.repoDir, [
      "merge",
      "--no-ff",
      "-m",
      "chore: merge main into feature",
      "origin/main",
    ]);
    assert.equal(merge.code, 0, merge.stderr + merge.stdout);

    const push = pushReady(fixture);

    assert.equal(push.code, 0, push.stderr);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a branch nobody marked ready is refused by the hook and doesn't reach origin", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");

    const push = runGit(fixture.repoDir, ["push", "origin", "feature"]);

    assert.match(
      push.stderr,
      /refusing to push feature: its tip [0-9a-f]{7} has not been marked ready to push/,
    );
    assert.match(push.stderr, /run temple-bar ready in the worktree/);
    assert.notEqual(push.code, 0);
    assert.notEqual(
      runGit(fixture.originDir, ["rev-parse", "--verify", "refs/heads/feature"])
        .code,
      0,
    );
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a commit made after the mark needs ready again", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    const marked = markReady(fixture.repoDir);
    commitFile(fixture, "b.txt");

    const push = runGit(fixture.repoDir, ["push", "origin", "feature"]);

    assert.match(push.stderr, /has not been marked ready to push/);
    assert.match(
      push.stderr,
      new RegExp(`The commit marked here is ${marked.slice(0, 7)}`),
    );
    assert.notEqual(push.code, 0);
  } finally {
    fixture.cleanup();
  }
});

void test("pre-push: a mark in one worktree doesn't let another worktree's commit out", () => {
  const fixture = setUp();
  try {
    commitFile(fixture, "a.txt");
    markReady(fixture.repoDir);
    const otherDir = path.join(fixture.root, "other");
    assert.equal(
      runGit(fixture.repoDir, [
        "worktree",
        "add",
        "-q",
        "-b",
        "other",
        otherDir,
      ]).code,
      0,
    );
    writeFileSync(path.join(otherDir, "c.txt"), "c\n", "utf8");
    assert.equal(runGit(otherDir, ["add", "c.txt"]).code, 0);
    assert.equal(
      runGit(otherDir, ["commit", "-q", "-m", "feat: add c.txt"]).code,
      0,
    );

    const push = runGit(otherDir, ["push", "origin", "other"]);

    assert.match(push.stderr, /refusing to push other: .*not been marked/);
    assert.notEqual(push.code, 0);
    // The mark in the first worktree still lets its own branch out.
    const own = runGit(fixture.repoDir, ["push", "origin", "feature"]);
    assert.equal(own.code, 0, own.stderr);
  } finally {
    fixture.cleanup();
  }
});
