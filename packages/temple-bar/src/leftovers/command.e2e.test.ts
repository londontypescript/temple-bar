// `temple-bar leftovers` with no flag, against real git with only GitHub
// faked: it reports what finished pull requests left behind, each with the
// verdict `--remove` would reach, and deletes none of it.

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import test from "node:test";

import {
  addWorktree,
  destructive,
  git,
  makeRepos,
  merged,
  world,
  write,
} from "./testing/repos.ts";

void test("the report gives each leftover its verdict, and deletes nothing", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)]);

  const report = await w.leftovers([], repos.primary);
  assert.equal(report.code, 0, report.err);
  assert.match(
    report.out,
    /worktree .*x \(feat\/x, pull request #7 merged\): kept: not released: the session there hasn't run `temple-bar leftovers --release`\n/,
  );
  assert.match(
    report.out,
    /local branch feat\/x \(pull request #7 merged\): kept: it is checked out in .*x, which is kept\n/,
  );
  assert.match(
    report.out,
    /remote branch origin\/feat\/x \(pull request #7 merged\): would remove\n/,
  );
  assert.ok(existsSync(x.path));
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("a branch reusing a merged pull request's name for new work is kept, saying so", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const w = world(repos, () => [merged(x, 7)]);
  // New, unpushed work on a branch named like pull request #7's.
  write(x.path, "new.ts", "export const n = 1;\n");
  git(x.path, "add", "new.ts");
  git(x.path, "commit", "-q", "-m", "feat: new");

  const report = await w.leftovers([], repos.primary);
  assert.match(
    report.out,
    /worktree .*x \(feat\/x, pull request #7 merged\): kept: it holds commits beyond pull request #7's head\n/,
  );
  // The pushed branch still ends at #7's last commit, so it is finished.
  assert.match(
    report.out,
    /remote branch origin\/feat\/x \(pull request #7 merged\): would remove/,
  );
});

void test("an open pull request, or none, is live work and isn't reported", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  addWorktree(repos, "y");
  const w = world(repos, () => [merged(x, 7, { state: "OPEN" })]);
  const report = await w.leftovers([], repos.primary);
  assert.equal(report.out, "leftovers: no leftover branches or worktrees\n");
});

void test("a worktree whose folder is gone is reported and kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  rmSync(x.path, { recursive: true, force: true });
  const w = world(repos, () => []);
  const report = await w.leftovers([], repos.primary);
  assert.match(
    report.out,
    /worktree .*x \(feat\/x\): kept: its folder is gone; `git worktree prune` drops it from git's list\n/,
  );
});

void test("leftovers takes at most one of its flags", async (t) => {
  const repos = makeRepos(t);
  const w = world(repos, () => []);
  for (const args of [["--bogus"], ["--remove", "--release"], ["x"]]) {
    const run = await w.leftovers(args, repos.primary);
    assert.equal(run.code, 2, args.join(" "));
    assert.match(
      run.err,
      /^leftovers: (unknown argument: |give at most one of --release, --unrelease, --remove)/,
    );
  }
});
