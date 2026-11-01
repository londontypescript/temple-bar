// The worktree reader and isDirty against real repositories: what git lists
// and what counts as work merge must not disturb.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitSeam } from "../seams/git.ts";
import { createFakeContext } from "../testing/fakes.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import {
  isDirty,
  listWorktrees,
  parseWorktreeListStrict,
} from "./worktrees.ts";

void test("isDirty: untracked files don't count, a changed tracked file does", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-dirty-"));
  try {
    initTestRepo(dir);
    writeFileSync(path.join(dir, "README.md"), "hello\n");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "chore: start"], { cwd: dir });
    const ctx = createFakeContext({ git: createGitSeam(), cwd: dir });

    // Like node_modules on main before the setup's .gitignore arrives.
    writeFileSync(path.join(dir, "untracked.txt"), "x\n");
    assert.equal(await isDirty(ctx, dir), false, "untracked only");

    writeFileSync(path.join(dir, "README.md"), "changed\n");
    assert.equal(await isDirty(ctx, dir), true, "tracked file changed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

/** A repo with one commit; the test's `t` removes its folder. */
function repoWithCommit(t: { after: (fn: () => void) => void }): {
  root: string;
  repo: string;
} {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "temple-bar-worktrees-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  initTestRepo(repo);
  writeFileSync(path.join(repo, "a"), "a\n");
  git(repo, "add", "a");
  git(repo, "commit", "-q", "-m", "init");
  return { root, repo };
}

/** git's own spelling of a path: forward slashes, even on Windows. */
function asGit(entry: string): string {
  return entry.split(path.sep).join("/");
}

// Windows can't name a folder with a newline.
void test(
  "listWorktrees: with -z, a worktree whose path holds a newline is read whole",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root, repo } = repoWithCommit(t);
    const odd = path.join(root, "wt\nnewline");
    git(repo, "worktree", "add", "-q", "-b", "nl", odd);
    const ctx = createFakeContext({ git: createGitSeam(), cwd: repo });

    const listed = await listWorktrees(ctx, repo);
    assert.deepEqual(
      listed.map((worktree) => [worktree.path, worktree.branch]),
      [
        [repo, "main"],
        [odd, "nl"],
      ],
    );
  },
);

void test("listWorktrees: the same layout as git 2.34's reads the same with -z", async (t) => {
  const { root, repo } = repoWithCommit(t);
  for (const branch of ["feature", "locked-reason", "locked-plain", "gone"]) {
    git(repo, "branch", branch);
  }
  const at = (name: string) => path.join(root, name);
  git(repo, "worktree", "add", "-q", at("wt-feature"), "feature");
  git(repo, "worktree", "add", "-q", "--detach", at("wt-detached"), "HEAD");
  git(repo, "worktree", "add", "-q", at("wt-locked-reason"), "locked-reason");
  git(
    repo,
    "worktree",
    "lock",
    "--reason",
    "held by tool pid 42",
    at("wt-locked-reason"),
  );
  git(repo, "worktree", "add", "-q", at("wt-locked-plain"), "locked-plain");
  git(repo, "worktree", "lock", at("wt-locked-plain"));
  git(repo, "worktree", "add", "-q", at("wt-gone"), "gone");
  rmSync(at("wt-gone"), { recursive: true, force: true });
  const ctx = createFakeContext({ git: createGitSeam(), cwd: repo });

  const listed = await listWorktrees(ctx, repo);
  const head = git(repo, "rev-parse", "HEAD").trim();
  // What the strict reader makes of git 2.34's listing of this layout, with
  // this repo's folder and commit (merge/worktrees.test.ts reads that).
  const old = parseWorktreeListStrict(
    readFileSync(
      new URL(
        "./worktree-list-fixtures/git-2.34/normal/porcelain.txt",
        import.meta.url,
      ),
      "utf8",
    ),
  ).map((worktree) => ({
    ...worktree,
    path: asGit(worktree.path.replace("/work/normal", root)),
    head: worktree.head === undefined ? undefined : head,
  }));
  assert.deepEqual(
    listed
      .map((worktree) => ({ ...worktree, path: asGit(worktree.path) }))
      .sort((a, b) =>
        a.primary ? -1 : b.primary ? 1 : a.path.localeCompare(b.path),
      ),
    old,
  );
});
