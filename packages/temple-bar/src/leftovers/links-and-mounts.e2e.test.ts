// The guards against removing more than the worktree through a mount or a
// link, against real git with only GitHub faked. A mount can't be made
// without administrator rights, so the disk is real but one folder reads as
// another device; Windows' junctions are tested where they exist, in CI.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { realLink } from "../init/testing/write-target-repo.ts";
import { createFsSeam, type FsSeam } from "../seams/fs.ts";
import { samePath } from "./paths.ts";
import {
  addWorktree,
  assertKept,
  commitAll,
  git,
  makeRepos,
  merged,
  release,
  releasedWorktree as released,
  world,
  write,
} from "./testing/repos.ts";

/** The real disk, but `folder` reads as another device: a mount, which a
 * test can't make without administrator rights. */
function mountedAt(folder: string): FsSeam {
  const real = createFsSeam();
  return {
    ...real,
    deviceId: (entry) =>
      samePath(entry, folder) ? Promise.resolve(999n) : real.deviceId(entry),
  };
}

void test("guard: a mounted folder inside it keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, "node_modules/mnt/data.bin", "x\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `a mounted folder inside it: ${JSON.stringify("node_modules/mnt")}`,
    { fs: mountedAt(path.join(x.path, "node_modules", "mnt")) },
  );
});

void test("guard: a folder whose device can't be read keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, "node_modules/mnt/data.bin", "x\n");
  const real = createFsSeam();
  const mnt = path.join(x.path, "node_modules", "mnt");
  await assertKept(
    w,
    repos.primary,
    x,
    `can't tell whether these are mounted folders: ${JSON.stringify("node_modules/mnt")}`,
    {
      fs: {
        ...real,
        deviceId: (entry) =>
          samePath(entry, mnt)
            ? Promise.reject(new Error("EACCES"))
            : real.deviceId(entry),
      },
    },
  );
});

// On Windows a volume mount point is a junction to lstat, so a junction
// leading outside keeps the worktree, and git must list it as one entry:
// if git descends into it, removing the worktree could reach its target.
void test(
  "guard: on Windows, a junction leading outside keeps it, and git doesn't follow it",
  { skip: process.platform !== "win32" },
  async (t) => {
    const { repos, x, w } = await released(t);
    const outside = path.join(repos.root, "outside");
    write(outside, "keep.txt", "keep\n");
    realLink(outside, path.join(x.path, "node_modules", "out"), true);
    const listed = git(
      x.path,
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
    ).split("\0");
    if (listed.some((entry) => entry.startsWith("node_modules/out/"))) {
      assert.fail(
        "git followed a junction to a folder outside the worktree: stop, this needs a decision",
      );
    }
    await assertKept(
      w,
      repos.primary,
      x,
      `a link or junction leading outside it: ${JSON.stringify("node_modules/out")}`,
    );
    assert.ok(existsSync(path.join(outside, "keep.txt")));
  },
);

void test(
  "on Windows, a junction to a workspace package inside the worktree passes, and it is removed",
  { skip: process.platform !== "win32" },
  async (t) => {
    const repos = makeRepos(t);
    const x = addWorktree(repos, "x");
    write(x.path, "packages/pkg/index.ts", "export const p = 1;\n");
    const head = commitAll(x.path, "feat: a package");
    git(x.path, "push", "-q", "origin", x.branch);
    realLink(
      path.join(x.path, "packages", "pkg"),
      path.join(x.path, "node_modules", "pkg"),
      true,
    );
    const w = world(repos, () => [merged({ ...x, head }, 7)]);
    await release(w, x.path);
    const removed = await w.leftovers(["--remove"], repos.primary);
    assert.equal(removed.code, 0, removed.out + removed.err);
    assert.equal(existsSync(x.path), false);
  },
);

/** The real disk, but the link at `link` reads as pointing at a name with
 * bytes that aren't UTF-8, as Node decodes it: U+FFFD. */
function undecodableLink(link: string): FsSeam {
  const real = createFsSeam();
  return {
    ...real,
    readlink: (entry) =>
      samePath(entry, link)
        ? Promise.resolve("target-�")
        : real.readlink(entry),
  };
}

void test("guard: a link whose target isn't valid UTF-8 can't be certified: --release refuses it", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const link = path.join(x.path, ".temple-bar", "link");
  realLink(x.path, link, true);
  const w = world(repos, () => []);
  const run = await w.leftovers(["--release"], x.path, {
    fs: undecodableLink(link),
  });
  assert.equal(run.code, 1);
  assert.equal(
    run.err,
    `leftovers: not released, nothing written:\nleftovers:   the link ${JSON.stringify(".temple-bar/link")} points at a name that isn't valid UTF-8, so it can't be certified\n`,
  );
});

void test("guard: a link whose target isn't valid UTF-8 invalidates a marker", async (t) => {
  const repos = makeRepos(t);
  const x = addWorktree(repos, "x", { push: false });
  const link = path.join(x.path, ".temple-bar", "link");
  realLink(x.path, link, true);
  const w = world(repos, () => [merged(x, 7)]);
  await release(w, x.path);
  await assertKept(
    w,
    repos.primary,
    x,
    `its ignored files can't be compared with its release: the link ${JSON.stringify(".temple-bar/link")} points at a name that isn't valid UTF-8, so it can't be certified`,
    { fs: undecodableLink(link) },
  );
});
