// The guards on which worktree `--remove` may touch at all, each against
// real git with only GitHub faked: every fixture fails exactly one guard,
// and the worktree is kept for exactly that reason with nothing deleted.

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import {
  addWorktree,
  assertKept,
  blob,
  commitAll,
  destructive,
  git,
  makeRepos,
  merged,
  release,
  RELEASED_REF,
  REMOVING_REF,
  world,
  write,
} from "./testing/repos.ts";

void test("guard: the primary checkout is never a candidate, even released on a merged branch", async (t) => {
  const repos = makeRepos(t);
  // The primary checkout on a merged branch, with a marker as --release
  // would write it (which refuses the primary checkout itself).
  git(repos.primary, "switch", "-q", "-c", "feat/p");
  write(repos.primary, "p.ts", "export const p = 1;\n");
  const head = commitAll(repos.primary, "feat: p");
  git(
    repos.primary,
    "update-ref",
    RELEASED_REF,
    blob(
      repos.primary,
      `${JSON.stringify({ version: 1, head, branch: "refs/heads/feat/p", files: {} })}\n`,
    ),
  );
  // Run from another worktree, so its own folder isn't the reason.
  const y = addWorktree(repos, "y", { push: false });
  const w = world(repos, () => [merged({ branch: "feat/p", head }, 7)]);

  const run = await w.leftovers(["--remove"], y.path);
  assert.doesNotMatch(run.out + run.err, /the worktree at .*primary/);
  assert.match(
    run.err,
    /kept the local branch feat\/p: it is checked out in the primary checkout/,
  );
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: a worktree git sees at another path than it lists is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  // git's record names a link to the folder, so git lists the link's path
  // while the folder itself answers with its real one.
  const link = path.join(repos.root, "alias");
  realLink(x.path, link, true);
  writeFileSync(
    path.join(repos.primary, ".git", "worktrees", "x", "gitdir"),
    `${link}/.git\n`,
  );
  const alias = { ...x, path: link };
  await assertKept(
    w,
    repos.primary,
    alias,
    `git sees its top folder as ${x.path}, not the listed path`,
  );
});

void test("guard: a listed worktree that is another repository's is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x");
  // Another clone, with a worktree on the same branch and commit, released
  // there; then x's .git file is pointed at that clone's worktree.
  const other = path.join(repos.root, "other");
  git(repos.root, "clone", "-q", repos.origin, other);
  const twin = path.join(repos.root, "twin");
  git(other, "worktree", "add", "-q", twin, x.branch);
  git(repos.origin, "branch", "-q", "-D", x.branch);
  const w = world(repos, () => [merged(x, 7)]);
  await release(
    world({ origin: repos.origin }, () => []),
    twin,
  );
  writeFileSync(
    path.join(x.path, ".git"),
    `gitdir: ${path.join(other, ".git", "worktrees", "twin")}\n`,
  );
  await assertKept(
    w,
    repos.primary,
    x,
    `it belongs to another repository (${path.join(other, ".git").split(path.sep).join("/")})`,
  );
});

void test("guard: a worktree nobody released is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await assertKept(
    w,
    repos.primary,
    x,
    "not released: the session there hasn't run `temple-bar leftovers --release`",
  );
});

void test("guard: a worktree another run has claimed is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  const marker = git(x.path, "rev-parse", RELEASED_REF).trim();
  git(x.path, "update-ref", REMOVING_REF, marker);
  git(x.path, "update-ref", "-d", RELEASED_REF);
  await assertKept(
    w,
    repos.primary,
    x,
    "another run has claimed it for removal",
  );
});

void test("guard: a locked worktree is kept, with the lock's reason", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  git(
    repos.primary,
    "worktree",
    "lock",
    "--reason",
    "held by tool pid 42",
    x.path,
  );
  await assertKept(
    w,
    repos.primary,
    x,
    "locked by another tool (held by tool pid 42)",
  );
});

void test("guard: a worktree whose folder is gone is kept, pointing at git worktree prune", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  rmSync(x.path, { recursive: true, force: true });
  const run = await w.leftovers(["--remove"], repos.primary);
  assert.ok(
    run.err.includes(
      `kept the worktree at ${x.path} (feat/x): its folder is gone; \`git worktree prune\` drops it from git's list\n`,
    ),
    run.err,
  );
  assert.deepEqual(destructive(w.git.calls), []);
});

void test("guard: a worktree holding this command's folder, INIT_CWD or PWD is kept", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const inside = path.join(x.path, "src");
  mkdirSync(inside);
  writeFileSync(path.join(inside, "a.ts"), "export const a = 1;\n");
  commitAll(x.path, "feat: a");
  const head = git(x.path, "rev-parse", "HEAD").trim();
  const w = world(repos, () => [merged({ ...x, head }, 7)]);
  await release(w, x.path);
  const at = { ...x, head };
  await assertKept(w, inside, at, "this command's folder is inside it");
  await assertKept(w, repos.primary, at, "INIT_CWD is inside it", {
    env: { INIT_CWD: x.path },
  });
  await assertKept(w, repos.primary, at, "PWD is inside it", {
    env: { PWD: inside },
  });
  const gone = path.join(repos.root, "gone");
  await assertKept(w, repos.primary, at, `PWD (${gone}) can't be resolved`, {
    env: { PWD: gone },
  });
});
