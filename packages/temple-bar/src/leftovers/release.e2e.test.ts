// `leftovers --release` against real git: it works from the session's own
// folder in a worktree another tool has locked, and refuses, writing
// nothing, anything that would make the release a false promise.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createFsSeam } from "../seams/fs.ts";
import { samePath } from "./paths.ts";
import {
  addWorktree,
  git,
  makeRepos,
  world,
  write,
  type Branch,
  type Repos,
} from "./testing/repos.ts";

void test("--release works from the session's own folder in a worktree another tool has locked", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  git(
    repos.primary,
    "worktree",
    "lock",
    "--reason",
    "held by tool pid 42",
    x.path,
  );
  write(x.path, ".claude/settings.local.json", "{}\n");
  const w = world(repos, () => []);
  const run = await w.leftovers(["--release"], x.path, {
    env: { PWD: x.path, INIT_CWD: x.path },
  });
  assert.equal(run.code, 0, run.err);
  assert.match(run.out, /released .*x on feat\/x at [0-9a-f]{40}/);
  assert.ok(
    run.out.includes(`  ${JSON.stringify(".claude/settings.local.json")}\n`),
  );
});

/** Asserts `--release` refuses with exactly `reasons`, one a line, and
 * wrote no ref. */
async function refuses(
  repos: Repos,
  x: Pick<Branch, "path">,
  reasons: string | readonly string[],
  fs = createFsSeam(),
): Promise<void> {
  const w = world(repos, () => []);
  const run = await w.leftovers(["--release"], x.path, { fs });
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    `leftovers: not released, nothing written:\n${[reasons]
      .flat()
      .map((reason) => `leftovers:   ${reason}\n`)
      .join("")}`,
  );
  assert.equal(git(x.path, "for-each-ref", "refs/worktree/"), "");
}

void test("--release refuses each thing that would keep the worktree at removal, writing nothing", async (t) => {
  const repos = makeRepos(t);
  const cases: [string, (x: Branch) => void, string | string[]][] = [
    [
      "nested",
      (x) => {
        git(
          repos.root,
          "clone",
          "-q",
          repos.origin,
          path.join(x.path, "node_modules", "dep"),
        );
      },
      `a repository inside it: ${JSON.stringify("node_modules/dep/")}`,
    ],
    [
      "gitlink",
      (x) => {
        git(
          x.path,
          "update-index",
          "--add",
          "--cacheinfo",
          `160000,${x.head},sub`,
        );
      },
      [
        `a submodule in its index: ${JSON.stringify("sub")}`,
        `staged or unstaged changes: ${JSON.stringify("sub")}`,
      ],
    ],
    [
      "hidden",
      (x) => {
        git(x.path, "update-index", "--skip-worktree", "README.md");
      },
      `assume-unchanged or skip-worktree entries, whose changes git hides: ${JSON.stringify("README.md")}`,
    ],
    [
      "operation",
      (x) => {
        git(x.path, "update-ref", "refs/bisect/bad", x.head);
      },
      `per-worktree refs: ${JSON.stringify("refs/bisect/bad")}`,
    ],
    [
      "staged",
      (x) => {
        write(x.path, "README.md", "changed\n");
        git(x.path, "add", "README.md");
      },
      `staged or unstaged changes: ${JSON.stringify("README.md")}`,
    ],
    [
      "untracked",
      (x) => {
        write(x.path, "scratch.txt", "x\n");
      },
      `untracked files: ${JSON.stringify("scratch.txt")}`,
    ],
  ];
  for (const [name, make, reason] of cases) {
    const x = addWorktree(repos, name, { push: false });
    make(x);
    await refuses(repos, x, reason);
  }
});

void test("--release refuses a mounted folder", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  write(x.path, "dist/mnt/out.js", "x\n");
  const real = createFsSeam();
  const mnt = path.join(x.path, "dist", "mnt");
  await refuses(
    repos,
    x,
    `a mounted folder inside it: ${JSON.stringify("dist/mnt")}`,
    {
      ...real,
      deviceId: (entry) =>
        samePath(entry, mnt) ? Promise.resolve(7n) : real.deviceId(entry),
    },
  );
});

void test("--release refuses the primary checkout, a detached HEAD and a branch alias", async (t) => {
  const repos = makeRepos(t);
  const w = world(repos, () => []);
  const primary = await w.leftovers(["--release"], repos.primary);
  assert.equal(
    primary.err,
    "leftovers: not released, nothing written:\nleftovers:   this is the primary checkout: release runs in a linked worktree\n",
  );
  const detached = addWorktree(repos, "d", { push: false });
  git(detached.path, "switch", "-q", "--detach");
  await refuses(repos, detached, "HEAD isn't on a branch");
  const aliased = addWorktree(repos, "a", { push: false });
  git(
    repos.primary,
    "symbolic-ref",
    "refs/heads/alias",
    `refs/heads/${aliased.branch}`,
  );
  git(aliased.path, "symbolic-ref", "HEAD", "refs/heads/alias");
  await refuses(
    repos,
    aliased,
    `HEAD is on refs/heads/alias, a symbolic ref to refs/heads/${aliased.branch}`,
  );
});
