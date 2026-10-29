// What merge tells the user to do when it needs a worktree: never to run
// `git worktree add`, which the rules setup writes forbid, but to have the
// harness make one.

import assert from "node:assert/strict";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { defaultWorld, harness } from "./testing/world.ts";

void test("a behind branch no worktree has: the refusal says to have the harness make one, never git worktree add", async () => {
  const world = defaultWorld();
  world.behind = true;
  world.worktrees = "";
  const h = harness(world);
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 1);
  assert.match(
    h.err(),
    /no worktree has feat\/x checked out\. Check feat\/x out in a worktree your harness makes, then run merge again\./,
  );
  assert.doesNotMatch(h.err(), /git worktree add/);
});

void test("a primary checkout that doesn't list temple-bar yet: the install advice names a harness-made worktree, never git worktree add", async () => {
  const h = harness(defaultWorld());
  await h.ctx.fs.writeText(
    "/repo/package.json",
    JSON.stringify({ name: "app" }),
  );
  assert.equal(await createMergeCommand(h.deps).run(["7"], h.ctx), 0, h.err());
  assert.match(
    h.out(),
    /run pnpm install in a new worktree of origin\/main, made by your harness\./,
  );
  assert.doesNotMatch(h.out(), /git worktree add/);
});
