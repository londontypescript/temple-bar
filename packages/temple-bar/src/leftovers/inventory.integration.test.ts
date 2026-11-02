// Which links keep a worktree on Windows, on a real disk: Git for Windows'
// removal follows a junction or a directory link and deletes through it,
// so any link whose real target is a folder, or can't be resolved, is
// found, wherever it points. A link to a file is removed as a link.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createFakeContext } from "../testing/fakes.ts";
import { junctionsAndDirectoryLinks } from "./inventory.ts";
import { write } from "./testing/repos.ts";

const FOLLOWED =
  "a junction or directory link inside it, which Git for Windows walks into when it removes a worktree: ";

void test("a link to a folder, inside or outside, or to nothing, is found; a link to a file isn't", async (t) => {
  const root = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-links-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const worktree = path.join(root, "wt");
  write(worktree, "packages/pkg/index.ts", "export const p = 1;\n");
  write(root, "outside/keep.txt", "keep\n");
  mkdirSync(path.join(worktree, "node_modules"));
  const modules = (name: string) => path.join(worktree, "node_modules", name);
  realLink(path.join(worktree, "packages", "pkg"), modules("pkg"), true);
  realLink(path.join(root, "outside"), modules("out"), true);
  realLink(path.join(root, "missing"), modules("gone"), true);
  realLink(path.join(worktree, "packages", "pkg", "index.ts"), modules("file"));
  const ctx = createFakeContext({ fs: createFsSeam() });
  const check = (ignored: string[]) =>
    junctionsAndDirectoryLinks(ctx, worktree, {
      tracked: [],
      untracked: [],
      ignored,
    });

  for (const name of ["pkg", "out", "gone"]) {
    assert.deepEqual(
      await check([`node_modules/${name}`]),
      [`${FOLLOWED}${JSON.stringify(`node_modules/${name}`)}`],
      name,
    );
  }
  assert.deepEqual(await check(["node_modules/file"]), []);
  // Listed itself and as a folder git lists through, it is named once.
  assert.deepEqual(
    await check(["node_modules/out", "node_modules/out/keep.txt"]),
    [`${FOLLOWED}${JSON.stringify("node_modules/out")}`],
  );
});
