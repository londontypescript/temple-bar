// The walk for `.git` entries, against real git with only GitHub faked: git
// lists nothing under a `.git` folder that isn't a valid repository, so
// these fixtures are invisible to every git list, and only the walk keeps
// the worktree. Each is made after the release and fails only this guard.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import { createFsSeam } from "../seams/fs.ts";
import { samePath } from "./paths.ts";
import {
  addWorktree,
  assertKept,
  git,
  makeRepos,
  merged,
  release,
  releasedWorktree as released,
  world,
  write,
} from "./testing/repos.ts";

const HIDES = "a .git entry inside it, which hides what is under it from git: ";

const DEEP = ["node_modules/a/b/c", "dist/a/b/c", ".temple-bar/a/b/c"] as const;

/** A clone whose `.git` has lost HEAD, so git no longer takes it for a
 * repository. Inside `.temple-bar/`, which a release watches, it holds no
 * other file, so only the walk can see it. */
function brokenClone(origin: string, at: string, watched: boolean): void {
  if (watched) {
    git(path.dirname(at), "init", "-q", at);
  } else {
    mkdirSync(path.dirname(at), { recursive: true });
    git(path.dirname(at), "clone", "-q", origin, at);
  }
  rmSync(path.join(at, ".git", "HEAD"));
}

for (const deep of DEEP) {
  void test(`guard: a clone whose .git lost HEAD, under ${deep}, keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    const at = path.join(x.path, deep, "broken");
    mkdirSync(path.dirname(at), { recursive: true });
    brokenClone(repos.origin, at, deep.startsWith(".temple-bar"));
    const listed = git(
      x.path,
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
    ).split("\0");
    assert.equal(
      listed.some(
        (entry) =>
          entry.startsWith(`${deep}/broken/.git/`) ||
          entry === `${deep}/broken/`,
      ),
      false,
      "git lists nothing under its .git, and doesn't take it for a repository",
    );
    await assertKept(
      w,
      repos.primary,
      x,
      `${HIDES}${JSON.stringify(`${deep}/broken/.git`)}`,
    );
  });

  void test(`guard: a bare repository inside a plain .git folder, under ${deep}, keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    const plain = path.join(x.path, deep, "cache", ".git");
    mkdirSync(plain, { recursive: true });
    git(repos.root, "init", "-q", "--bare", path.join(plain, "backup.git"));
    await assertKept(
      w,
      repos.primary,
      x,
      `${HIDES}${JSON.stringify(`${deep}/cache/.git`)}`,
    );
  });
}

void test("guard: a note written into a .git folder under .temple-bar/ after the release keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, ".temple-bar/x/.git/note.md", "resumed\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `${HIDES}${JSON.stringify(".temple-bar/x/.git")}`,
  );
});

void test("--release refuses a broken clone git can't see", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  brokenClone(repos.origin, path.join(x.path, "node_modules", "broken"), false);
  const run = await world(repos, () => []).leftovers(["--release"], x.path);
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    `leftovers: not released, nothing written:\nleftovers:   ${HIDES}${JSON.stringify("node_modules/broken/.git")}\n`,
  );
});

void test("guard: a folder the walk can't read keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, "dist/out.js", "built\n");
  const real = createFsSeam();
  const dist = path.join(x.path, "dist");
  await assertKept(
    w,
    repos.primary,
    x,
    `folders that can't be walked: ${JSON.stringify("dist")}`,
    {
      fs: {
        ...real,
        readdir: (entry) =>
          samePath(entry, dist)
            ? Promise.reject(new Error("EACCES"))
            : real.readdir(entry),
      },
    },
  );
});

void test("guard: a mount git lists nothing through (it holds only a hidden repository) keeps it, and the walk doesn't enter it", async (t) => {
  const { repos, x, w } = await released(t);
  const plain = path.join(x.path, "node_modules", "mnt", "cache", ".git");
  mkdirSync(plain, { recursive: true });
  git(repos.root, "init", "-q", "--bare", path.join(plain, "backup.git"));
  const real = createFsSeam();
  const mnt = path.join(x.path, "node_modules", "mnt");
  await assertKept(
    w,
    repos.primary,
    x,
    `a mounted folder inside it: ${JSON.stringify("node_modules/mnt")}`,
    {
      fs: {
        ...real,
        deviceId: (entry) =>
          samePath(entry, mnt) ? Promise.resolve(999n) : real.deviceId(entry),
      },
    },
  );
});

// On Windows a junction leading outside keeps the worktree on its own.
void test(
  "the walk never follows a link: a link to a repository outside doesn't keep it",
  { skip: process.platform === "win32" },
  async (t) => {
    const repos = makeRepos(t);
    const x = addWorktree(repos, "x");
    const outside = path.join(repos.root, "outside-clone");
    git(repos.root, "clone", "-q", repos.origin, outside);
    realLink(outside, path.join(x.path, "node_modules", "linked"), true);
    const w = world(repos, () => [merged(x, 7)]);
    await release(w, x.path);
    const removed = await w.leftovers(["--remove"], repos.primary);
    assert.equal(removed.code, 0, removed.out + removed.err);
    assert.equal(existsSync(x.path), false);
    assert.ok(
      existsSync(path.join(outside, ".git", "HEAD")),
      "the repository outside stays",
    );
  },
);
