// `leftovers --release` then `--remove` against real git, with only GitHub
// faked: a released worktree on a merged branch goes with its local and
// remote branches and its ignored local data, and nothing outside it.

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import {
  addWorktree,
  destructive,
  git,
  gitLine,
  makeRepos,
  merged,
  world,
  write,
} from "./testing/repos.ts";

// No merge command runs here: GitHub says MERGED and origin's branch is
// at the head, as after an admin merge on GitHub's website.
void test("a released worktree on a merged branch goes with its branches and ignored data; a link's target outside stays", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  const outside = path.join(repos.root, "outside");
  mkdirSync(outside);
  write(outside, "keep.txt", "keep\n");
  write(x.path, "node_modules/pkg/index.js", "module.exports = 1;\n");
  // On Windows a junction leading outside keeps the worktree (it can't be
  // told from a mount point there), so the link points outside only on
  // other systems; links-and-mounts.e2e.test.ts has Windows' cases.
  if (process.platform !== "win32") {
    realLink(outside, path.join(x.path, "node_modules", "linked"), true);
  }
  write(x.path, "dist/out.js", "built\n");
  write(x.path, ".temple-bar/notes.md", "secret notes\n");
  write(x.path, ".env", "TOKEN=abc\n");
  write(x.path, ".claude/settings.local.json", "{}\n");
  const w = world(repos, () => [merged(x, 7)]);

  const released = await w.leftovers(["--release"], x.path);
  assert.equal(released.code, 0, released.err);
  for (const file of [
    ".env",
    ".temple-bar/notes.md",
    ".claude/settings.local.json",
  ]) {
    assert.ok(released.out.includes(`"${file}"`), released.out);
  }
  assert.doesNotMatch(released.out, /"(?:node_modules|dist)\//);
  assert.match(
    released.out,
    /all ignored local data in it, \.temple-bar\/ included/,
  );
  const blob = git(
    x.path,
    "cat-file",
    "blob",
    "refs/worktree/temple-bar/released",
  );
  assert.match(blob, /"\.env":"file:[0-9a-f]{40,64}"/);
  assert.doesNotMatch(blob, /secret notes|TOKEN=abc/);

  const report = await w.leftovers([], repos.primary);
  assert.equal(report.code, 0);
  assert.match(
    report.out,
    /worktree .*x \(feat\/x, pull request #7 merged\): would remove\n/,
  );
  assert.deepEqual(destructive(w.git.calls), []);

  const removed = await w.leftovers(["--remove"], repos.primary);
  assert.equal(removed.code, 0, `${removed.out}${removed.err}`);
  assert.equal(existsSync(x.path), false);
  assert.ok(
    existsSync(path.join(outside, "keep.txt")),
    "the link's target stays",
  );
  assert.equal(gitLine(repos.primary, "branch", "--list", x.branch), "");
  assert.equal(git(repos.origin, "branch", "--list", x.branch), "");
  assert.match(removed.out, /removed the worktree at .*x \(feat\/x\)/);
  assert.match(removed.out, /deleted the local branch feat\/x/);
  assert.match(
    removed.out,
    /deleted origin\/feat\/x, whose tip was still the merged/,
  );
});
