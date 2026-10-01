// Integration tests for the reference-transaction hook, against a real git
// repo with the real shim installed (see testing/repo-fixture.ts). These are
// the tests that matter most: reference-transaction is the hook that can't
// be bypassed with `--no-verify`, which is verified directly below.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  installRealHooks,
  pushToOriginMain,
  runGit,
} from "./testing/repo-fixture.ts";

void test("reference-transaction: --no-verify on main is still refused (git does not skip this hook)", () => {
  const fixture = createHookFixture();
  try {
    const origin = alignWithOrigin(fixture);
    assert.equal(installRealHooks(fixture).code, 0);

    writeFileSync(path.join(fixture.repoDir, "local.txt"), "x\n", "utf8");
    runGit(fixture.repoDir, ["add", "local.txt"]);
    const commit = runGit(fixture.repoDir, [
      "commit",
      "--no-verify",
      "-m",
      "diverge",
    ]);

    assert.notEqual(commit.code, 0);
    assert.match(commit.stderr + commit.stdout, /refusing to move local main/);
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, origin, "main must not have moved");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: refuses when refs/remotes/origin/main does not exist at all", () => {
  const fixture = createHookFixture();
  try {
    // origin exists as a remote but was never fetched: no
    // refs/remotes/origin/main locally.
    assert.equal(installRealHooks(fixture).code, 0);

    writeFileSync(path.join(fixture.repoDir, "x.txt"), "x\n", "utf8");
    runGit(fixture.repoDir, ["add", "x.txt"]);
    const commit = runGit(fixture.repoDir, [
      "commit",
      "--no-verify",
      "-m",
      "first",
    ]);

    assert.notEqual(commit.code, 0);
    assert.match(commit.stderr + commit.stdout, /does not exist/);
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: a local squash merge onto main is refused", () => {
  const fixture = createHookFixture();
  try {
    const origin = alignWithOrigin(fixture);
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "feat.txt"), "f\n", "utf8");
    runGit(fixture.repoDir, ["add", "feat.txt"]);
    runGit(fixture.repoDir, ["commit", "-q", "-m", "feat: feature work"]);
    runGit(fixture.repoDir, ["checkout", "-q", "main"]);

    assert.equal(installRealHooks(fixture).code, 0);

    runGit(fixture.repoDir, ["merge", "-q", "--squash", "feature"]);
    const commit = runGit(fixture.repoDir, [
      "commit",
      "--no-verify",
      "-m",
      "squashed",
    ]);

    assert.notEqual(commit.code, 0);
    assert.match(
      commit.stderr + commit.stdout,
      /refusing to move local main to a commit not on/,
    );
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, origin, "main must not have moved");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: a local merge onto main is refused", () => {
  const fixture = createHookFixture();
  try {
    const origin = alignWithOrigin(fixture);
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "feat.txt"), "f\n", "utf8");
    runGit(fixture.repoDir, ["add", "feat.txt"]);
    runGit(fixture.repoDir, ["commit", "-q", "-m", "feat: feature work"]);
    runGit(fixture.repoDir, ["checkout", "-q", "main"]);

    assert.equal(installRealHooks(fixture).code, 0);

    const merge = runGit(fixture.repoDir, [
      "merge",
      "--no-ff",
      "-m",
      "chore: merge feature",
      "feature",
    ]);

    assert.notEqual(merge.code, 0);
    assert.match(
      merge.stderr + merge.stdout,
      /refusing to move local main to a commit not on/,
    );
    // git has already written the merge into the working tree, so the
    // refusal says how to keep or drop it.
    assert.match(merge.stderr + merge.stdout, /git switch -c <name>/);
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, origin, "main must not have moved");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: a cherry-pick onto main is refused", () => {
  const fixture = createHookFixture();
  try {
    const origin = alignWithOrigin(fixture);
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "feat.txt"), "f\n", "utf8");
    runGit(fixture.repoDir, ["add", "feat.txt"]);
    runGit(fixture.repoDir, ["commit", "-q", "-m", "feat: feature work"]);
    const featureSha = runGit(fixture.repoDir, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();
    runGit(fixture.repoDir, ["checkout", "-q", "main"]);

    assert.equal(installRealHooks(fixture).code, 0);

    const pick = runGit(fixture.repoDir, ["cherry-pick", featureSha]);

    assert.notEqual(pick.code, 0);
    assert.match(
      pick.stderr + pick.stdout,
      /refusing to move local main to a commit not on/,
    );
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, origin, "main must not have moved");
  } finally {
    // Abort any in-progress cherry-pick before removing the directory.
    runGit(fixture.repoDir, ["cherry-pick", "--abort"]);
    fixture.cleanup();
  }
});

void test("reference-transaction: git reset --hard onto a commit not on origin/main is refused", () => {
  const fixture = createHookFixture();
  try {
    const origin = alignWithOrigin(fixture);
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(path.join(fixture.repoDir, "feat.txt"), "f\n", "utf8");
    runGit(fixture.repoDir, ["add", "feat.txt"]);
    runGit(fixture.repoDir, ["commit", "-q", "-m", "feat: feature work"]);
    const featureSha = runGit(fixture.repoDir, [
      "rev-parse",
      "HEAD",
    ]).stdout.trim();
    runGit(fixture.repoDir, ["checkout", "-q", "main"]);

    assert.equal(installRealHooks(fixture).code, 0);

    // reset --hard never runs pre-commit (no commit is created), so this is
    // the cleanest proof that reference-transaction blocks it by itself.
    const reset = runGit(fixture.repoDir, ["reset", "--hard", featureSha]);

    assert.notEqual(reset.code, 0);
    assert.match(
      reset.stderr + reset.stdout,
      /refusing to move local main to a commit not on/,
    );
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, origin, "main must not have moved");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: deleting local main is refused", () => {
  const fixture = createHookFixture();
  try {
    alignWithOrigin(fixture);
    runGit(fixture.repoDir, ["checkout", "-q", "-b", "other"]);

    assert.equal(installRealHooks(fixture).code, 0);

    const del = runGit(fixture.repoDir, [
      "update-ref",
      "-d",
      "refs/heads/main",
    ]);

    assert.notEqual(del.code, 0);
    assert.match(del.stderr + del.stdout, /refusing to delete local main/);
    const stillThere = runGit(fixture.repoDir, [
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/main",
    ]);
    assert.equal(stillThere.code, 0, "refs/heads/main must still exist");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: git pull --ff-only is allowed after a merge on GitHub, and main moves", () => {
  const fixture = createHookFixture();
  try {
    const first = alignWithOrigin(fixture);
    assert.equal(installRealHooks(fixture).code, 0);

    // Simulate a merge that happened on GitHub: a second clone pushes
    // straight to origin's main.
    const second = pushToOriginMain(
      fixture.root,
      fixture.originDir,
      "merged-on-github.txt",
      "y\n",
    );
    assert.notEqual(first, second);

    const fetch = runGit(fixture.repoDir, ["fetch", "-q", "origin"]);
    assert.equal(fetch.code, 0);

    const pull = runGit(fixture.repoDir, [
      "pull",
      "--ff-only",
      "origin",
      "main",
    ]);

    assert.equal(pull.code, 0);
    const head = runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, second, "main must have moved to the new commit");
  } finally {
    fixture.cleanup();
  }
});

void test("reference-transaction: a fetch touching only refs/remotes/origin/main never starts Node", () => {
  const fixture = createHookFixture();
  try {
    alignWithOrigin(fixture);
    assert.equal(installRealHooks(fixture).code, 0);

    const markerPath = path.join(fixture.root, "node-was-started.marker");
    fixture.installMarkerBin(markerPath);

    // A second commit on origin's main, purely a fetch target: this only
    // updates refs/remotes/origin/main locally, never refs/heads/main.
    pushToOriginMain(fixture.root, fixture.originDir, "more.txt", "m\n");
    const fetch = runGit(fixture.repoDir, ["fetch", "-q", "origin"]);

    assert.equal(fetch.code, 0);
    assert.equal(
      existsSync(markerPath),
      false,
      "the reference-transaction shim must not have started the CLI",
    );
  } finally {
    fixture.cleanup();
  }
});
