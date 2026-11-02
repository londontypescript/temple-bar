// The guards on what is inside a worktree that removing its folder could
// lose, against real git with only GitHub faked. Each fixture is made after
// the release (which refuses all of them) and fails exactly one guard; the
// worktree is kept for exactly that reason, and nothing is deleted.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createFsSeam } from "../seams/fs.ts";
import { samePath } from "./paths.ts";

import {
  addWorktree,
  asGit,
  assertKept,
  commitAll,
  git,
  makeRepos,
  merged,
  moveMarker,
  release,
  releasedWorktree as released,
  world,
  write,
} from "./testing/repos.ts";

/** The walk's reason for a `.git` entry git's lists can't show. */
const HIDES = "a .git entry inside it, which hides what is under it from git: ";

/** `node_modules`, `dist` and `.temple-bar/`, several folders down. */
const DEEP = ["node_modules/a/b/c", "dist/a/b/c", ".temple-bar/a/b/c"] as const;

void test("guard: another worktree listed inside it keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  // Its folder is gone, so only git's list of worktrees shows it.
  const nested = path.join(x.path, "dist", "nested");
  git(repos.primary, "worktree", "add", "-q", "-b", "nested", nested);
  rmSync(nested, { recursive: true, force: true });
  await assertKept(
    w,
    repos.primary,
    x,
    `another worktree is inside it: ${JSON.stringify(asGit(nested))}`,
  );
});

for (const deep of DEEP) {
  void test(`guard: a clone under ${deep} keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    git(
      repos.root,
      "clone",
      "-q",
      repos.origin,
      path.join(x.path, deep, "clone"),
    );
    await assertKept(
      w,
      repos.primary,
      x,
      `a repository inside it: ${JSON.stringify(`${deep}/clone/`)}; ${HIDES}${JSON.stringify(`${deep}/clone/.git`)}`,
    );
  });

  void test(`guard: a worktree under ${deep} keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    const nested = path.join(x.path, deep, "wt");
    git(repos.primary, "worktree", "add", "-q", "-b", "nested", nested);
    await assertKept(
      w,
      repos.primary,
      x,
      `another worktree is inside it: ${JSON.stringify(asGit(nested))}; a repository inside it: ${JSON.stringify(`${deep}/wt/`)}; ${HIDES}${JSON.stringify(`${deep}/wt/.git`)}`,
    );
  });

  void test(`guard: a bare repository under ${deep} keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    git(
      repos.root,
      "init",
      "-q",
      "--bare",
      path.join(x.path, deep, "bare.git"),
    );
    const bare = `a bare repository inside it: ${JSON.stringify(`${deep}/bare.git`)}`;
    // Inside .temple-bar/ its files are also new ignored files, which the
    // release watches.
    await assertKept(
      w,
      repos.primary,
      x,
      deep.startsWith(".temple-bar")
        ? new RegExp(
            `^${RegExp.escape(bare)}; ignored files changed since it was released: `,
          )
        : bare,
    );
  });
}

void test("guard: a bare repository whose HEAD is tracked under an ignored dist/ keeps it", async (t) => {
  const { repos, x, w, merge } = await released(t);
  git(repos.root, "init", "-q", "--bare", path.join(x.path, "dist", "repo"));
  git(x.path, "add", "-f", "dist/repo/HEAD");
  const head = commitAll(x.path, "chore: a tracked HEAD");
  merge(head);
  moveMarker(x.path, head);
  await assertKept(
    w,
    repos.primary,
    { ...x },
    `a bare repository inside it: ${JSON.stringify("dist/repo")}`,
  );
});

// git leaves out anything named `.git`, and on a case-insensitive disk
// `.GIT` too, unless told the disk is case-sensitive: then it lists it.
void test(
  "guard: a path named .git in any case keeps it",
  { skip: process.platform === "win32" },
  async (t) => {
    const { repos, x, w } = await released(t);
    git(repos.primary, "config", "core.ignorecase", "false");
    write(x.path, "node_modules/pkg/.GIT/keep", "x\n");
    await assertKept(
      w,
      repos.primary,
      x,
      `a path named .git inside it: ${JSON.stringify("node_modules/pkg/.GIT/keep")}; ${HIDES}${JSON.stringify("node_modules/pkg/.GIT")}`,
    );
  },
);

// Windows has no such permission bits, and root reads any folder.
void test(
  "guard: a folder git can't open, which it only warns about, keeps it",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async (t) => {
    const { repos, x, w } = await released(t);
    const locked = path.join(x.path, "node_modules", "locked");
    write(x.path, "node_modules/locked/a.js", "x\n");
    chmodSync(locked, 0o000);
    try {
      await assertKept(
        w,
        repos.primary,
        x,
        /^git couldn't list its files \(.*node_modules\/locked.*\)$/,
      );
    } finally {
      // Before the test's folder is deleted, which needs it readable.
      chmodSync(locked, 0o755);
    }
  },
);

void test("guard: a gitlink in the index keeps it, with no .gitmodules", async (t) => {
  const { repos, x, w, merge } = await released(t);
  git(
    x.path,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${x.head},vendor/sub`,
  );
  // An empty folder, as a submodule nobody initialised has.
  mkdirSync(path.join(x.path, "vendor", "sub"), { recursive: true });
  // Committed as staged: `git add -A` would drop a gitlink with no folder.
  git(x.path, "commit", "-q", "-m", "chore: a gitlink");
  const head = git(x.path, "rev-parse", "HEAD").trim();
  merge(head);
  moveMarker(x.path, head);
  await assertKept(
    w,
    repos.primary,
    x,
    `a submodule in its index: ${JSON.stringify("vendor/sub")}`,
  );
});

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  void test(`guard: a ${flag} edit, which git hides, keeps it`, async (t) => {
    const { repos, x, w } = await released(t);
    git(x.path, "update-index", flag, "x.ts");
    write(x.path, "x.ts", "export const x = 2;\n");
    await assertKept(
      w,
      repos.primary,
      x,
      `assume-unchanged or skip-worktree entries, whose changes git hides: ${JSON.stringify("x.ts")}`,
    );
  });
}

void test("guard: a --no-commit merge with a clean tree keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  git(repos.primary, "commit", "-q", "--allow-empty", "-m", "chore: later");
  git(x.path, "merge", "-q", "--no-commit", "-s", "ours", "main");
  assert.equal(git(x.path, "status", "--porcelain"), "", "the tree is clean");
  await assertKept(
    w,
    repos.primary,
    x,
    "a git operation is under way (MERGE_HEAD)",
  );
});

void test("guard: another tool's per-worktree ref keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  git(x.path, "update-ref", "refs/worktree/other-tool/state", x.head);
  await assertKept(
    w,
    repos.primary,
    x,
    `per-worktree refs: ${JSON.stringify("refs/worktree/other-tool/state")}`,
  );
});

void test("guard: an unstaged change keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, "README.md", "changed\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `staged or unstaged changes: ${JSON.stringify("README.md")}`,
  );
});

void test("guard: an untracked file keeps it", async (t) => {
  const { repos, x, w } = await released(t);
  write(x.path, "notes.txt", "mine\n");
  await assertKept(
    w,
    repos.primary,
    x,
    `untracked files: ${JSON.stringify("notes.txt")}`,
  );
});

// Linux keeps any bytes in a name; macOS and Windows refuse invalid UTF-8.
void test(
  "guard: a path that isn't valid UTF-8 keeps it",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { repos, x, w } = await released(t);
    mkdirSync(path.join(x.path, "node_modules"), { recursive: true });
    const name = Buffer.concat([
      Buffer.from(path.join(x.path, "node_modules", "bad-")),
      Buffer.from([0xff]),
    ]);
    write(x.path, "node_modules/ok.js", "x\n");
    await import("node:fs").then(({ writeFileSync }) => {
      writeFileSync(name, "x\n");
    });
    await assertKept(
      w,
      repos.primary,
      x,
      `paths that aren't valid UTF-8, so can't be checked: ${JSON.stringify("node_modules/bad-�")}`,
    );
  },
);

// macOS and Windows refuse such names, so here git's output, the disk's
// listing, or both carry one the way Node decodes it: as U+FFFD. Seen by
// either, or both, it is one reason.
for (const [seen, byGit, byWalk] of [
  ["git", true, false],
  ["git and the walk", true, true],
  ["only the walk", false, true],
] as const) {
  void test(`guard: a path that isn't valid UTF-8, seen by ${seen}, keeps it, on any disk`, async (t) => {
    const repos = makeRepos(t);
    const x = addWorktree(repos, "x", { push: false });
    let inject = false;
    const w = world(repos, () => [merged(x, 7)], {
      hooks: {
        before: ({ args, cwd }) =>
          Promise.resolve(
            inject &&
              byGit &&
              samePath(cwd, x.path) &&
              args.join(" ") ===
                "ls-files -z --others --ignored --exclude-standard"
              ? {
                  code: 0,
                  stdout: `${git(cwd, ...args)}node_modules/bad-\uFFFD\0`,
                  stderr: "",
                }
              : undefined,
          ),
      },
    });
    await release(w, x.path);
    inject = true;
    write(x.path, "node_modules/ok.js", "x\n");
    const real = createFsSeam();
    const modules = path.join(x.path, "node_modules");
    await assertKept(
      w,
      repos.primary,
      x,
      `paths that aren't valid UTF-8, so can't be checked: ${JSON.stringify("node_modules/bad-\uFFFD")}`,
      {
        fs: {
          ...real,
          readdir: async (entry) => {
            const entries = await real.readdir(entry);
            return byWalk && samePath(entry, modules) && entries !== undefined
              ? [...entries, { name: "bad-\uFFFD", kind: "file" }]
              : entries;
          },
        },
      },
    );
  });
}

// Neither a newline nor a trailing space can end a name on Windows.
void test(
  "paths with a trailing space or a newline are used whole: certified, then removed",
  { skip: process.platform === "win32" },
  async (t) => {
    const repos = makeRepos(t);
    const odd = addWorktree(repos, "odd", { folder: "wt odd\nname " });
    write(odd.path, ".temple-bar/notes ", "a\n");
    write(odd.path, ".temple-bar/two\nlines", "b\n");
    const w = world(repos, () => [merged(odd, 7)]);
    const run = await w.leftovers(["--release"], odd.path);
    assert.equal(run.code, 0, run.err);
    assert.ok(
      run.out.includes(`  ${JSON.stringify(".temple-bar/notes ")}\n`),
      run.out,
    );
    assert.ok(
      run.out.includes(`  ${JSON.stringify(".temple-bar/two\nlines")}\n`),
      run.out,
    );
    const removed = await w.leftovers(["--remove"], repos.primary);
    assert.equal(removed.code, 0, removed.out + removed.err);
    assert.equal(existsSync(odd.path), false);
  },
);
