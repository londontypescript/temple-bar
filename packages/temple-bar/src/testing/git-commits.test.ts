// commitFiles never makes a commit missing a path the test asked for, even
// where git drops one without failing: a path that is also another's folder,
// or a symlink named .gitmodules.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { commitFiles } from "./git-commits.ts";
import { initTestRepo } from "./git-repo.ts";

function newRepo(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-git-commits-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  return dir;
}

void test("a path that is also another path's folder is refused, not silently replaced", (t) => {
  const dir = newRepo(t);
  assert.throws(
    () => commitFiles(dir, { a: "x", "a/b": "y" }),
    /git left out \["a"\]/,
  );
});

void test("a symlink named .gitmodules is refused, in any folder and any case", (t) => {
  const dir = newRepo(t);
  for (const name of [".gitmodules", "sub/.gitmodules", ".GitModules"]) {
    assert.throws(
      () => commitFiles(dir, { [name]: { symlink: "elsewhere" } }),
      /git left out/,
      name,
    );
  }
});
