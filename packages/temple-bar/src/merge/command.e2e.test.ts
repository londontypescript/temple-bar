// End to end against real git repositories, with only GitHub faked, so
// merge's local work (merging main in, the plain push, fast-forwarding
// main, deleting the remote branch under its lease, and keeping the
// worktree and the local branch) runs on real git.

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createMergeCommand } from "./command.ts";
import {
  commitFile,
  context,
  deps,
  fakeGitHub,
  git,
  setUp,
} from "./testing/e2e-repos.ts";

void test("merges a behind branch end to end: main merged in, plain push, squash, remote branch deleted, worktree and branch kept", async (t) => {
  const setup = setUp(t);
  const { gh, calls } = fakeGitHub(setup, { state: "open", body: "- add x\n" });
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

  assert.ok(existsSync(setup.worktree), "the worktree is kept");
  assert.equal(
    git(setup.clone, "rev-parse", "refs/heads/feat/x"),
    mergedHead,
    "the local branch is kept at the merged head",
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
  const out = stdout.lines.join("");
  assert.ok(
    out.includes(
      `merge: deleted origin/feat/x, whose tip was still the merged ${mergedHead}\n`,
    ),
    out,
  );
  assert.match(
    out,
    new RegExp(
      `merge: kept the worktree at .*wt-x on feat/x \\(${mergedHead}\\);`,
    ),
  );
  // GitHub lists the pull request at the head it accepted, so the kept
  // worktree and branch are listed next, for whoever removes them.
  assert.match(out, /merge: leftovers: 2 left behind/);
  assert.match(
    out,
    /leftovers: {3}worktree .*wt-x: its branch feat\/x's pull request #7 is merged/,
  );
  assert.match(
    out,
    /leftovers: {3}local branch feat\/x: pull request #7 merged/,
  );
});

void test("a branch of several commits with no bullets merges with its title and co-authors only", async (t) => {
  const setup = setUp(t);
  commitFile(setup.worktree, "z.ts", "export const z = 3;\n", "wip");
  git(setup.worktree, "push", "origin", "feat/x");
  const { gh } = fakeGitHub(setup, {
    state: "open",
    body: "Adds x, in one change.\n",
  });
  const { ctx, stderr } = context(setup.worktree, gh);

  const code = await createMergeCommand(deps).run(["7"], ctx);
  assert.equal(code, 0, stderr.lines.join(""));
  // The squash message never pastes in the branch's commits ("wip").
  assert.equal(
    git(setup.origin, "log", "-1", "--format=%B", "main"),
    "feat: add x (#7)\n\nCo-Authored-By: Ada <ada@example.com>",
  );
});

void test("refuses a behind branch whose worktree has uncommitted work, and changes nothing", async (t) => {
  const setup = setUp(t);
  writeFileSync(path.join(setup.worktree, "x.ts"), "export const x = 2;\n");
  const { gh, calls } = fakeGitHub(setup, { state: "open", body: "- add x\n" });
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
