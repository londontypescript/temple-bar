// End to end against real git repositories, with only GitHub faked, so
// merge's local work (merging main in, the plain push, removing the
// worktree and both branches, and fast-forwarding main) runs on real git.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import { context, deps, fakeGitHub, git, setUp } from "./testing/e2e-repos.ts";

void test("merges a behind branch end to end: main merged in, plain push, squash, everything tidied", async () => {
  const setup = setUp();
  const { gh, calls } = fakeGitHub(setup, "- add x\n");
  const { ctx, stdout, stderr } = context(setup.worktree, gh);

  const code = await createMergeCommand(deps).run(["7"], ctx);
  assert.equal(code, 0, stderr.lines.join(""));

  // The push only added to the branch: the old tip is an ancestor of what
  // GitHub merged, so nothing was force-pushed.
  const merge = calls.find((c) => c[0] === "pr" && c[1] === "merge") ?? [];
  const mergedHead = merge[merge.indexOf("--match-head-commit") + 1] ?? "";
  assert.notEqual(mergedHead, setup.pushedTip);
  git(setup.clone, "merge-base", "--is-ancestor", setup.pushedTip, mergedHead);
  assert.equal(
    git(setup.origin, "log", "-1", "--format=%B", "main"),
    "feat: add x (#7)\n\n- add x\n\nCo-Authored-By: Ada <ada@example.com>",
  );

  assert.equal(existsSync(setup.worktree), false, "worktree removed");
  assert.equal(
    git(setup.clone, "branch", "--list", "feat/x"),
    "",
    "local branch deleted",
  );
  assert.equal(
    git(setup.origin, "branch", "--list", "feat/x"),
    "",
    "remote branch deleted",
  );
  assert.equal(
    git(setup.clone, "rev-parse", "main"),
    git(setup.origin, "rev-parse", "main"),
    "main fast-forwarded",
  );
  assert.match(
    stdout.lines.join(""),
    /deleted origin\/feat\/x and confirmed it is gone/,
  );
});

void test("refuses a behind branch whose worktree has uncommitted work, and changes nothing", async () => {
  const setup = setUp();
  writeFileSync(path.join(setup.worktree, "x.ts"), "export const x = 2;\n");
  const { gh, calls } = fakeGitHub(setup, "- add x\n");
  const { ctx, stderr } = context(setup.clone, gh);

  const code = await createMergeCommand(deps).run(["7"], ctx);
  assert.equal(code, 1);
  assert.match(
    stderr.lines.join(""),
    /behind main, but the worktree at .*wt-x has uncommitted changes/,
  );
  assert.equal(
    git(setup.origin, "rev-parse", "refs/heads/feat/x"),
    setup.pushedTip,
  );
  assert.equal(
    calls.some((c) => c[1] === "merge"),
    false,
  );
});
