// Integration tests for a repo whose default branch is `master`: the hooks
// protect whatever origin/HEAD names, not a branch called `main`.

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

function head(fixture: HookFixture): string {
  return runGit(fixture.repoDir, ["rev-parse", "HEAD"]).stdout.trim();
}

function commitFile(
  fixture: HookFixture,
  name: string,
  extraArgs: readonly string[] = [],
) {
  writeFileSync(path.join(fixture.repoDir, name), `${name}\n`, "utf8");
  runGit(fixture.repoDir, ["add", name]);
  return runGit(fixture.repoDir, [
    "commit",
    ...extraArgs,
    "-m",
    `chore: ${name}`,
  ]);
}

function masterRepo(): HookFixture {
  const fixture = createHookFixture({ branch: "master" });
  alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  return fixture;
}

void test("default branch: a commit on master is refused where origin's default is master", () => {
  const fixture = masterRepo();
  try {
    const before = head(fixture);

    const result = commitFile(fixture, "a.txt");

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refusing to commit directly to master/);
    assert.equal(head(fixture), before);
  } finally {
    fixture.cleanup();
  }
});

void test("default branch: --no-verify on master is still refused by reference-transaction", () => {
  const fixture = masterRepo();
  try {
    const before = head(fixture);

    const result = commitFile(fixture, "a.txt", ["--no-verify"]);

    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /refusing to move local master to a commit not on refs\/remotes\/origin\/master/,
    );
    assert.equal(head(fixture), before);
  } finally {
    fixture.cleanup();
  }
});

void test("default branch: git pull on master fast-forwards to a merge on GitHub", () => {
  const fixture = masterRepo();
  try {
    const merged = pushToOriginMain(
      fixture.root,
      fixture.originDir,
      "merged.txt",
      "m\n",
      "master",
    );

    const result = runGit(fixture.repoDir, ["pull"]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(head(fixture), merged);
  } finally {
    fixture.cleanup();
  }
});

void test("default branch: only the default branch is protected, so a local main in a master repo takes commits", () => {
  const fixture = masterRepo();
  try {
    runGit(fixture.repoDir, ["switch", "-q", "-c", "main"]);

    const result = commitFile(fixture, "a.txt");

    assert.equal(result.code, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});

void test("default branch: commits and merges on a feature branch never start Node", () => {
  const fixture = masterRepo();
  try {
    const markerPath = path.join(fixture.root, "node-was-started.marker");
    runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]);
    pushToOriginMain(
      fixture.root,
      fixture.originDir,
      "merged.txt",
      "m\n",
      "master",
    );
    assert.equal(runGit(fixture.repoDir, ["fetch", "-q", "origin"]).code, 0);
    fixture.installMarkerBin(markerPath);

    // --no-verify skips pre-commit and commit-msg, which always start the
    // CLI (merge accepts it too); this is about reference-transaction alone.
    const commit = commitFile(fixture, "a.txt", ["--no-verify"]);
    const merge = runGit(fixture.repoDir, [
      "merge",
      "-q",
      "--no-verify",
      "--no-edit",
      "origin/master",
    ]);

    assert.equal(commit.code, 0, commit.stderr);
    assert.equal(merge.code, 0, merge.stderr);
    assert.equal(
      existsSync(markerPath),
      false,
      "the reference-transaction shim must not have started the CLI",
    );
  } finally {
    fixture.cleanup();
  }
});
