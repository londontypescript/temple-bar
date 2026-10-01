// Integration tests for `git fetch origin main:main`, which updates local
// `main` without checking it out. A plain fetch moves `main` in its own ref
// transaction before it updates `refs/remotes/origin/main`; `--atomic` puts
// both in one transaction. Either way the commit is GitHub's `main`, so the
// move is allowed, and a fetch into `main` of anything else is not.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  alignWithOrigin,
  createHookFixture,
  installRealHooks,
  pushToOriginMain,
  runGit,
  toShPath,
  type HookFixture,
} from "./testing/repo-fixture.ts";

function revParse(dir: string, ref: string): string {
  return runGit(dir, ["rev-parse", ref]).stdout.trim();
}

/** A fixture with local main aligned to origin, the real hooks installed,
 * and a feature branch checked out (git refuses to fetch into the branch
 * that is checked out). Returns the starting commit. */
function onFeatureBranch(fixture: HookFixture): string {
  const start = alignWithOrigin(fixture);
  assert.equal(installRealHooks(fixture).code, 0);
  assert.equal(
    runGit(fixture.repoDir, ["switch", "-q", "-c", "feature"]).code,
    0,
  );
  return start;
}

for (const atomic of [false, true]) {
  const fetch = atomic ? "git fetch --atomic" : "git fetch";

  void test(`fetch into main: \`${fetch} origin main:main\` after a merge on GitHub moves main there`, () => {
    const fixture = createHookFixture();
    try {
      onFeatureBranch(fixture);
      const merged = pushToOriginMain(
        fixture.root,
        fixture.originDir,
        "merged.txt",
        "m\n",
      );

      const result = runGit(fixture.repoDir, [
        "fetch",
        ...(atomic ? ["--atomic"] : []),
        "origin",
        "main:main",
      ]);

      assert.equal(result.code, 0, result.stderr);
      assert.equal(revParse(fixture.repoDir, "refs/heads/main"), merged);
      assert.equal(
        revParse(fixture.repoDir, "refs/remotes/origin/main"),
        merged,
      );
    } finally {
      fixture.cleanup();
    }
  });

  void test(`fetch into main: \`${fetch} origin <other branch>:main\` is refused`, () => {
    const fixture = createHookFixture();
    try {
      const start = onFeatureBranch(fixture);
      // A commit on another of origin's branches: not on origin's main.
      pushToOriginMain(
        fixture.root,
        fixture.originDir,
        "other.txt",
        "o\n",
        "other",
      );

      const result = runGit(fixture.repoDir, [
        "fetch",
        ...(atomic ? ["--atomic"] : []),
        "origin",
        "other:main",
      ]);

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /refusing to move local main/);
      assert.equal(revParse(fixture.repoDir, "refs/heads/main"), start);
    } finally {
      fixture.cleanup();
    }
  });
}

void test("fetch into main: fetching another remote's main into main is refused", () => {
  const fixture = createHookFixture();
  try {
    const start = onFeatureBranch(fixture);
    // A fork whose main is one commit ahead of origin's, so the fetch is a
    // fast-forward that git itself would allow.
    const forkDir = path.join(fixture.root, "fork.git");
    runGit(fixture.root, [
      "clone",
      "-q",
      "--bare",
      toShPath(fixture.originDir),
      forkDir,
    ]);
    pushToOriginMain(fixture.root, forkDir, "fork.txt", "f\n");
    runGit(fixture.repoDir, ["remote", "add", "fork", toShPath(forkDir)]);

    const result = runGit(fixture.repoDir, ["fetch", "fork", "main:main"]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refusing to move local main/);
    assert.equal(revParse(fixture.repoDir, "refs/heads/main"), start);
  } finally {
    fixture.cleanup();
  }
});
