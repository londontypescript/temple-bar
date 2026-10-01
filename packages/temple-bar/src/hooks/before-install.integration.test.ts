// Integration tests for a checkout whose hooks are configured but where
// temple-bar isn't installed yet (node_modules missing). The shims fail
// closed there, and these tests pin down what that leaves behind and how the
// user gets out of it.

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
  type HookFixture,
} from "./testing/repo-fixture.ts";

const INSTALL_THEN_RETRY =
  /Run pnpm install, then run the same git command again/;

function head(fixture: HookFixture): string {
  return runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
}

/** Tracked changes only: node_modules is untracked in the fixture. */
function trackedChanges(fixture: HookFixture): string {
  return runGit(fixture.repoDir, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]).stdout;
}

/** main aligned with origin and the hooks installed, then temple-bar
 * removed, and a new commit merged "on GitHub". Returns both commits. */
function pendingMergeBeforeInstall(fixture: HookFixture): {
  readonly before: string;
  readonly merged: string;
} {
  const before = alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  fixture.removeBin();
  const merged = pushToOriginMain(
    fixture.root,
    fixture.originDir,
    "merged-on-github.txt",
    "y\n",
  );
  return { before, merged };
}

void test("before install: git pull on main is refused before git touches the checkout, and works once installed", () => {
  const fixture = createHookFixture();
  try {
    const { before, merged } = pendingMergeBeforeInstall(fixture);

    const refused = runGit(fixture.repoDir, ["pull"]);

    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, INSTALL_THEN_RETRY);
    assert.equal(head(fixture), before, "main must not have moved");
    assert.equal(trackedChanges(fixture), "", "the checkout must be unchanged");
    assert.equal(
      existsSync(path.join(fixture.repoDir, "merged-on-github.txt")),
      false,
    );

    fixture.installRealBin();
    const retried = runGit(fixture.repoDir, ["pull"]);

    assert.equal(retried.code, 0, retried.stderr);
    assert.equal(head(fixture), merged);
    assert.equal(trackedChanges(fixture), "");
  } finally {
    fixture.cleanup();
  }
});

void test("before install: a fast-forward git refuses half-way is finished by running it again once installed", () => {
  const fixture = createHookFixture();
  try {
    const { before, merged } = pendingMergeBeforeInstall(fixture);
    assert.equal(runGit(fixture.repoDir, ["fetch", "-q", "origin"]).code, 0);

    // `checkout -B` records no ORIG_HEAD, so nothing refuses before git has
    // written the new files: it leaves them staged on the old commit.
    const command = ["checkout", "-q", "-B", "main", "origin/main"];
    const refused = runGit(fixture.repoDir, command);

    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, INSTALL_THEN_RETRY);
    assert.match(refused.stderr, /running the command again finishes it/);
    assert.equal(head(fixture), before);
    assert.match(trackedChanges(fixture), /merged-on-github\.txt/);

    fixture.installRealBin();
    const retried = runGit(fixture.repoDir, command);

    assert.equal(retried.code, 0, retried.stderr);
    assert.equal(head(fixture), merged);
    assert.equal(trackedChanges(fixture), "");
  } finally {
    fixture.cleanup();
  }
});

void test("before install: switching to main is not refused, since it doesn't move main", () => {
  const fixture = createHookFixture();
  try {
    alignWithOrigin(fixture);
    assert.equal(installRealHooks(fixture).code, 0);
    runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);
    fixture.removeBin();

    const result = runGit(fixture.repoDir, ["switch", "main"]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      runGit(fixture.repoDir, ["symbolic-ref", "HEAD"]).stdout.trim(),
      "refs/heads/main",
    );
  } finally {
    fixture.cleanup();
  }
});

void test("before install: a commit is refused with the same instructions", () => {
  const fixture = createHookFixture();
  try {
    alignWithOrigin(fixture);
    assert.equal(installRealHooks(fixture).code, 0);
    runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);
    fixture.removeBin();

    writeFileSync(path.join(fixture.repoDir, "f.txt"), "f\n", "utf8");
    runGit(fixture.repoDir, ["add", "f.txt"]);
    const result = runGit(fixture.repoDir, ["commit", "-m", "f"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, INSTALL_THEN_RETRY);
  } finally {
    fixture.cleanup();
  }
});
