// `temple-bar merge` and a released worktree, against real git with only
// GitHub faked: when merge brings the released worktree up to date and
// pushes, the release moves to merge's own commit and `--remove` can take
// the worktree once the pull request merged at that head. A commit the
// session made after releasing is never carried, so it keeps the worktree.

import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import test from "node:test";

import { createMergeCommand } from "../merge/command.ts";
import {
  commitFile,
  deps,
  fakeGitHub,
  git as gitTrimmed,
  setUp,
} from "../merge/testing/e2e-repos.ts";
import {
  assertKept,
  gitLine,
  release,
  RELEASED_REF,
  world,
} from "./testing/repos.ts";

const OPEN = { state: "open", body: "- add x" } as const;

void test("merge updated a released worktree: the release moved with it, and --remove takes it", async (t) => {
  const setup = setUp(t);
  const { gh } = fakeGitHub(setup, OPEN);
  const w = world({ origin: setup.origin }, () => [], { gh });
  await release(w, setup.worktree);

  const ctx = w.context(setup.clone);
  assert.equal(
    await createMergeCommand(deps).run(["7"], ctx),
    0,
    ctx.stderr.lines.join(""),
  );
  const tip = gitLine(setup.worktree, "rev-parse", "HEAD");
  assert.notEqual(tip, setup.pushedTip, "merge made its own commit");
  assert.match(
    ctx.stdout.lines.join(""),
    /merge: moved the release of .*wt-x to merge's own commit/,
  );
  const marker = JSON.parse(
    gitLine(setup.worktree, "cat-file", "blob", RELEASED_REF),
  ) as { head: string };
  assert.equal(marker.head, tip);

  const removed = await w.leftovers(["--remove"], setup.clone);
  assert.equal(removed.code, 0, removed.out + removed.err);
  assert.equal(existsSync(setup.worktree), false);
  assert.equal(gitTrimmed(setup.clone, "branch", "--list", "feat/x"), "");
});

void test("a commit made in the worktree after its release, merged the same way, keeps it", async (t) => {
  const setup = setUp(t);
  const { gh } = fakeGitHub(setup, OPEN);
  const w = world({ origin: setup.origin }, () => [], { gh });
  await release(w, setup.worktree);
  commitFile(
    setup.worktree,
    "late.ts",
    "export const late = 1;\n",
    "feat: late",
  );
  gitTrimmed(setup.worktree, "push", "origin", "feat/x");
  const late = gitLine(setup.worktree, "rev-parse", "HEAD");

  const ctx = w.context(setup.clone);
  assert.equal(
    await createMergeCommand(deps).run(["7"], ctx),
    0,
    ctx.stderr.lines.join(""),
  );
  assert.doesNotMatch(ctx.stdout.lines.join(""), /moved the release/);
  const tip = gitLine(setup.worktree, "rev-parse", "HEAD");
  const marker = JSON.parse(
    gitLine(setup.worktree, "cat-file", "blob", RELEASED_REF),
  ) as { head: string };
  assert.notEqual(marker.head, late);

  // A fresh record of git calls: merge itself deleted origin's branch.
  await assertKept(
    world({ origin: setup.origin }, () => [], { gh }),
    setup.clone,
    { path: realpathSync(setup.worktree), branch: "feat/x" },
    `HEAD moved since it was released (from ${setup.pushedTip} to ${tip})`,
  );
});
