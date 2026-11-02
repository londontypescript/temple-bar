// Whether a link leads outside the worktree, on a real disk: what counts is
// where its target really is, so a target written through another name for
// the worktree's folder (Windows' 8.3 short names, or any alias) is inside,
// and a target that doesn't resolve is outside.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import { createFsSeam } from "../seams/fs.ts";
import { createFakeContext } from "../testing/fakes.ts";
import { linksLeadingOutside } from "./inventory.ts";
import { write } from "./testing/repos.ts";

void test("a link counts as inside by its target's real path, and one that doesn't resolve as outside", async (t) => {
  const root = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "temple-bar-links-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const worktree = path.join(root, "wt");
  write(worktree, "packages/pkg/index.ts", "export const p = 1;\n");
  mkdirSync(path.join(worktree, "node_modules"));
  // Another name for the worktree's folder, outside it.
  const alias = path.join(root, "alias");
  realLink(worktree, alias, true);
  realLink(
    path.join(alias, "packages", "pkg"),
    path.join(worktree, "node_modules", "pkg"),
    true,
  );
  realLink(
    path.join(alias, "missing"),
    path.join(worktree, "node_modules", "gone"),
    true,
  );
  const ctx = createFakeContext({ fs: createFsSeam() });
  const check = (ignored: string[]) =>
    linksLeadingOutside(ctx, worktree, [worktree], {
      tracked: [],
      untracked: [],
      ignored,
    });

  assert.deepEqual(await check(["node_modules/pkg"]), []);
  assert.deepEqual(await check(["node_modules/gone"]), [
    `a link or junction leading outside it: ${JSON.stringify("node_modules/gone")}`,
  ]);
  // Listed itself and as a folder git lists through, it is named once.
  assert.deepEqual(
    await check(["node_modules/gone", "node_modules/gone/through.txt"]),
    [
      `a link or junction leading outside it: ${JSON.stringify("node_modules/gone")}`,
    ],
  );
});
