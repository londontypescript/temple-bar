// End to end against real git repositories, with only GitHub faked: the
// report finds what a finished pull request left behind, and deletes none
// of it.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  commitFile,
  context,
  fakeGitHub,
  git,
  ok,
  setUp,
} from "../merge/testing/e2e-repos.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { leftoversCommandEntry } from "./command.ts";

void test("leftovers reports a merged branch and its worktree, and deletes nothing", async () => {
  const setup = setUp();
  const { gh } = fakeGitHub(setup, "- add x\n");
  const { ctx, stdout } = context(setup.clone, gh);

  assert.equal(await leftoversCommandEntry.run([], ctx), 0);
  const out = stdout.lines.join("");
  assert.match(
    out,
    /worktree .*wt-x: its branch feat\/x's pull request #7 is merged/,
  );
  assert.match(
    out,
    /local branch feat\/x: pull request #7 merged \(git branch -D feat\/x\)/,
  );
  assert.match(out, /remote branch origin\/feat\/x: pull request #7 merged/);
  assert.ok(existsSync(setup.worktree));
  assert.notEqual(git(setup.clone, "branch", "--list", "feat/x"), "");
});

void test("leftovers leaves out a branch that reuses a merged pull request's name for new work", async () => {
  const setup = setUp();
  const { gh } = fakeGitHub(setup, "- add x\n");
  // New, unpushed work on a branch named like pull request #7's.
  commitFile(setup.worktree, "new.ts", "export const n = 1;\n", "feat: new");
  const { ctx, stdout } = context(setup.clone, gh);

  assert.equal(await leftoversCommandEntry.run([], ctx), 0);
  const out = stdout.lines.join("");
  assert.doesNotMatch(out, /local branch feat\/x/);
  assert.doesNotMatch(out, /worktree .*wt-x/);
  // The pushed branch still ends at #7's last commit, so it is finished.
  assert.match(out, /remote branch origin\/feat\/x: pull request #7 merged/);
});

void test("leftovers reports a worktree whose folder is gone", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-leftovers-"));
  initTestRepo(dir);
  commitFile(dir, "a.txt", "a\n", "base");
  const gone = `${dir}-gone`;
  git(dir, "worktree", "add", "-b", "old", gone);
  rmSync(gone, { recursive: true, force: true });
  const { ctx, stdout } = context(dir, {
    run: () => Promise.resolve(ok("[]")),
  });
  assert.equal(await leftoversCommandEntry.run([], ctx), 0);
  assert.match(stdout.lines.join(""), /worktree .*-gone: its folder is gone/);
  assert.match(stdout.lines.join(""), /not checked: remote branches/);
});
