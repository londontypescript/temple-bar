// What merge says when git removes the merged worktree but leaves its folder
// behind, as git for Windows does with pnpm's node_modules junctions.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { defaultWorld, harness } from "./testing/world.ts";

void test("a folder left holding only node_modules is finished off, and merge reports a clean removal", async () => {
  const world = defaultWorld();
  world.folderLeft = ["node_modules"];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.equal(world.folderLeft, undefined, "the folder was removed");
  assert.match(h.out(), /removed the worktree at \/wt\/x/);
  assert.match(h.out(), /no leftover branches or worktrees/);
  assert.doesNotMatch(h.err(), /cleanup is incomplete/);
});

void test("a folder left holding anything else is kept, and merge says cleanup is incomplete without claiming all is clean", async () => {
  const world = defaultWorld();
  world.folderLeft = ["node_modules", ".env"];
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.deepEqual(
    world.folderLeft,
    ["node_modules", ".env"],
    "nothing removed",
  );
  const err = h.err();
  assert.match(
    err,
    /left behind: git unregistered the worktree, but the folder remains at \/wt\/x \(it holds more than node_modules\)/,
  );
  assert.match(err, /cleanup is incomplete.*The pull request itself merged/);
  assert.match(h.out(), /merged #7/);
  assert.match(h.out(), /git lists no other leftover branches or worktrees/);
  assert.doesNotMatch(h.out(), /^merge: no leftover branches or worktrees$/m);
});
