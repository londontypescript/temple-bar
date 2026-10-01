// Hooks across worktrees, in real temp repos. The case these pin down: setup
// runs in one worktree while the primary checkout, and other worktrees, sit
// on branches from before setup, with no temple-bar installed. Every
// worktree must still be checked, none may be broken, and the primary
// checkout must be able to fast-forward main to the merged setup.

import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  runGit,
  runSh,
  toShPath,
  writeFakeBin,
  type HookFixture,
} from "./testing/repo-fixture.ts";

interface Worktrees {
  readonly fixture: HookFixture;
  /** The primary checkout: main, from before setup, nothing installed. */
  readonly primary: string;
  /** A worktree on a branch from before setup, nothing installed. */
  readonly old: string;
  /** The worktree setup ran in, with temple-bar installed. */
  readonly setup: string;
  readonly setupBin: string;
}

function commitFile(dir: string, file: string, message: string) {
  writeFileSync(path.join(dir, file), `${file}\n`, "utf8");
  runGit(dir, ["add", file]);
  return runGit(dir, ["commit", "-q", "-m", message]);
}

function setUpInAWorktree(): Worktrees {
  const fixture = createHookFixture();
  const primary = fixture.repoDir;
  alignWithOrigin(fixture);
  fixture.removeBin();
  const old = path.join(fixture.root, "old");
  const setup = path.join(fixture.root, "setup");
  assert.equal(
    runGit(primary, ["worktree", "add", "-q", "-b", "old", old]).code,
    0,
  );
  assert.equal(
    runGit(primary, ["worktree", "add", "-q", "-b", "setup", setup]).code,
    0,
  );

  // What `init` does in the setup worktree: install temple-bar, then hooks.
  const setupBin = writeFakeBin(setup);
  const install = runSh(setupBin, ["hook", "install"], setup);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  // ...and commit everything setup wrote but node_modules, as its next steps
  // say: whatever it leaves in the tree arrives with the merge.
  writeFileSync(path.join(setup, ".gitignore"), "node_modules/\n", "utf8");
  runGit(setup, ["add", "-A"]);
  const commit = runGit(setup, [
    "commit",
    "-q",
    "-m",
    "chore: set up temple-bar",
  ]);
  assert.equal(commit.code, 0, commit.stderr);
  return { fixture, primary, old, setup, setupBin };
}

void test("worktrees: after setup in one worktree, the primary checkout on a pre-setup main is checked too", () => {
  const w = setUpInAWorktree();
  try {
    const before = runGit(w.primary, ["rev-parse", "HEAD"]).stdout.trim();

    const result = commitFile(
      w.primary,
      "direct.txt",
      "feat: straight to main",
    );

    assert.notEqual(result.code, 0, "a commit to main must be refused");
    assert.match(result.stderr, /refusing to commit directly to main/);
    assert.equal(
      runGit(w.primary, ["rev-parse", "HEAD"]).stdout.trim(),
      before,
    );
  } finally {
    w.fixture.cleanup();
  }
});

void test("worktrees: a worktree on a branch from before setup still commits, and its commits are checked", () => {
  const w = setUpInAWorktree();
  try {
    const good = commitFile(w.old, "old.txt", "feat: work from before setup");
    const bad = commitFile(w.old, "bad.txt", "no prefix here");

    assert.equal(good.code, 0, good.stderr);
    assert.notEqual(bad.code, 0, "the commit-msg hook runs here too");
  } finally {
    w.fixture.cleanup();
  }
});

void test("worktrees: the primary checkout fast-forwards main to the merged setup, leaving nothing half-done", () => {
  const w = setUpInAWorktree();
  try {
    // The setup's pull request, merged on GitHub (the push stands in for
    // the merge, so the push hook isn't what this test is about).
    const push = runGit(w.setup, [
      "push",
      "-q",
      "--no-verify",
      "origin",
      "setup:main",
    ]);
    assert.equal(push.code, 0, push.stderr);
    const merged = runGit(w.setup, ["rev-parse", "HEAD"]).stdout.trim();

    const pull = runGit(w.primary, ["pull", "--ff-only"]);

    assert.equal(pull.code, 0, pull.stderr);
    assert.equal(
      runGit(w.primary, ["rev-parse", "HEAD"]).stdout.trim(),
      merged,
    );
    assert.equal(
      runGit(w.primary, ["status", "--porcelain", "--untracked-files=no"])
        .stdout,
      "",
    );
  } finally {
    w.fixture.cleanup();
  }
});

void test("worktrees: with temple-bar installed in no checkout at all, the hooks still fail closed", () => {
  const w = setUpInAWorktree();
  try {
    rmSync(w.setupBin);

    const result = commitFile(w.old, "old.txt", "feat: work from before setup");

    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /temple-bar is not installed in any checkout of this repo/,
    );
  } finally {
    w.fixture.cleanup();
  }
});

void test("worktrees: an older temple-bar in a worktree doesn't run hooks it may not know; the one that wrote them does", () => {
  const w = setUpInAWorktree();
  try {
    // An older release in the pre-setup worktree, which knows no hook at
    // all: it fails like an unknown subcommand, and leaves a mark if run.
    const oldBin = writeFakeBin(w.old);
    const marker = path.join(w.fixture.root, "old-temple-bar-ran");
    writeFileSync(
      oldBin,
      `#!/bin/sh\n: > "${toShPath(marker)}"\necho "Usage: temple-bar hook <pre-commit|install>" >&2\nexit 2\n`,
      "utf8",
    );

    const result = commitFile(
      w.old,
      "old.txt",
      "feat: work on an older branch",
    );

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      existsSync(marker),
      false,
      "the older temple-bar must not run",
    );
  } finally {
    w.fixture.cleanup();
  }
});
