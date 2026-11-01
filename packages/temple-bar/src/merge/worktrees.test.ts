// The worktree reader on git before 2.36, replaying what git 2.34.1 really
// wrote (worktree-list-fixtures/git-2.34): `-z` is rejected, the newline
// format is read strictly, and the listing must match git's own records.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  listWorktrees,
  parseWorktreeListStrict,
  parseWorktreeListZ,
  type Worktree,
} from "./worktrees.ts";

const FIXTURES = new URL("./worktree-list-fixtures/git-2.34/", import.meta.url);
const SHA = "f8570f8daa585704a075fe710d3ac126269629b6";

function read(name: string, file: string): string {
  return readFileSync(new URL(`${name}/${file}`, FIXTURES), "utf8");
}

/** A context whose git answers as git 2.34.1 did for the fixture `name`,
 * with git's `gitdir` records on its disk. */
function oldGit(name: string) {
  const commonDir = read(name, "common-dir.txt");
  const fs = createFakeFs();
  for (const id of readdirSync(new URL(`${name}/gitdir/`, FIXTURES))) {
    fs.files.set(
      path.join(commonDir.slice(0, -1), "worktrees", id, "gitdir"),
      read(name, `gitdir/${id}`),
    );
  }
  const git = createFakeGit((args) => {
    const joined = args.join(" ");
    if (joined === "worktree list --porcelain -z") {
      return {
        code: Number(read(name, "z-exit.txt")),
        stdout: read(name, "z-stdout.txt"),
        stderr: read(name, "z-stderr.txt"),
      };
    }
    if (joined === "worktree list --porcelain") {
      return { code: 0, stdout: read(name, "porcelain.txt"), stderr: "" };
    }
    if (joined === "rev-parse --path-format=absolute --git-common-dir") {
      return { code: 0, stdout: commonDir, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  return { ctx: createFakeContext({ git, fs }), git };
}

function entry(worktreePath: string, fields: Partial<Worktree> = {}): Worktree {
  return {
    path: worktreePath,
    branch: undefined,
    branchRef: undefined,
    head: SHA,
    primary: false,
    bare: false,
    detached: false,
    prunable: false,
    locked: false,
    lockReason: undefined,
    ...fields,
  };
}

function onBranch(name: string): Partial<Worktree> {
  return { branch: name, branchRef: `refs/heads/${name}` };
}

void test("on git 2.34, the strict reader reads branches, detached, locked and prunable worktrees, checked against git's records", async () => {
  const { ctx, git } = oldGit("normal");
  assert.deepEqual(await listWorktrees(ctx, "/work/normal/repo"), [
    entry("/work/normal/repo", { ...onBranch("main"), primary: true }),
    entry("/work/normal/wt-detached", { detached: true }),
    entry("/work/normal/wt-feature", onBranch("feature")),
    entry("/work/normal/wt-gone", { ...onBranch("gone"), prunable: true }),
    entry("/work/normal/wt-locked-plain", {
      ...onBranch("locked-plain"),
      locked: true,
    }),
    entry("/work/normal/wt-locked-reason", {
      ...onBranch("locked-reason"),
      locked: true,
      lockReason: "held by tool pid 42",
    }),
  ]);
  assert.deepEqual(
    git.calls.map((call) => call.args.join(" ")),
    [
      "worktree list --porcelain -z",
      "worktree list --porcelain",
      "rev-parse --path-format=absolute --git-common-dir",
    ],
  );
});

void test("on git 2.34, a worktree whose path holds a newline stops the listing rather than being guessed at", async () => {
  const { ctx } = oldGit("newline");
  await assert.rejects(
    listWorktrees(ctx, "/work/newline/repo"),
    /could not read git's worktree list: unexpected line in \/work\/newline\/wt's entry/,
  );
});

void test("on git 2.34, a path forged to read as two worktrees passes the line rules but not git's records", async () => {
  // Every line is well formed: the strict rules alone see two worktrees.
  const listed = parseWorktreeListStrict(read("forged", "porcelain.txt"));
  assert.deepEqual(
    listed.map((worktree) => [worktree.path, worktree.branch]),
    [
      ["/work/forged/repo", "main"],
      ["/work/forged/wt-decoy", "decoy"],
      ["/work/forged/wt-fake", "real"],
    ],
  );
  const { ctx } = oldGit("forged");
  await assert.rejects(
    listWorktrees(ctx, "/work/forged/repo"),
    /the worktrees listed are not the ones git records/,
  );
});

void test("with -z, a path holding a newline, a space or a lock reason with a newline is read whole", () => {
  const z =
    `worktree /repo\0HEAD ${SHA}\0branch refs/heads/main\0\0` +
    `worktree /wt/a\nb \0HEAD ${SHA}\0branch refs/heads/x\0locked two\nlines\0\0` +
    "worktree /bare\0bare\0\0";
  assert.deepEqual(parseWorktreeListZ(z), [
    entry("/repo", { ...onBranch("main"), primary: true }),
    entry("/wt/a\nb ", {
      ...onBranch("x"),
      locked: true,
      lockReason: "two\nlines",
    }),
    entry("/bare", { head: undefined, bare: true }),
  ]);
});

void test("a listing that isn't in git's format is refused, not guessed at", () => {
  const head = `worktree /repo\0HEAD ${SHA}\0`;
  for (const [what, z] of [
    ["cut short", `${head}branch refs/heads/main\0`],
    ["a key twice", `${head}HEAD ${SHA}\0detached\0\0`],
    ["branch and detached", `${head}branch refs/heads/main\0detached\0\0`],
    ["neither branch nor detached", `${head}\0`],
    ["no HEAD", "worktree /repo\0detached\0\0"],
    ["a HEAD that isn't an object id", "worktree /repo\0HEAD x\0detached\0\0"],
    ["an empty entry", `${head}detached\0\0\0`],
    ["no path", `worktree \0HEAD ${SHA}\0detached\0\0`],
  ] as const) {
    assert.throws(
      () => parseWorktreeListZ(z),
      /could not read git's worktree list/,
      what,
    );
  }
  // Only the newline format refuses a key it doesn't know.
  const extra = `${head}detached\0someday\0\0`;
  assert.equal(parseWorktreeListZ(extra).length, 1);
  assert.throws(
    () => parseWorktreeListStrict(extra.replaceAll("\0", "\n")),
    /unexpected line/,
  );
});

void test("a git that fails to list worktrees for another reason is an error, not a fallback", async () => {
  const git = createFakeGit(() => ({
    code: 128,
    stdout: "",
    stderr: "fatal: not a git repository\n",
  }));
  await assert.rejects(
    listWorktrees(createFakeContext({ git }), "/x"),
    /could not list git worktrees: fatal: not a git repository/,
  );
  assert.equal(git.calls.length, 1);
});
