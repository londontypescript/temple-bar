// The local reader behind `ready` and `merge`: each guarded path's state
// read exactly from git, through real repositories for what only real git
// shows (a missing object, a path git would quote), and through scripted
// answers for the shapes `git ls-tree` must never be trusted with.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { GitResult } from "../seams/git.ts";
import { createGitSeam } from "../seams/git.ts";
import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import {
  commitFiles,
  deleteObject,
  writeBlob,
} from "../testing/git-commits.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { checkChanges } from "./approval.ts";
import { changedPaths, stateAt } from "./guarded-states.ts";
import { readChanges } from "./manifests.ts";

const MANIFEST = JSON.stringify({
  name: "a",
  scripts: { test: "node --test" },
});
const CHANGED = JSON.stringify({ name: "a", scripts: { test: "y" } });
const NESTED = "packages/a/package.json";

function repo(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-guarded-states-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  const ctx = createFakeContext({ git: createGitSeam(), cwd: dir });
  return { dir, ctx };
}

void test("each side of a manifest is absent, valid, invalid or unreadable, and unreadable is never absent", async (t) => {
  const { dir, ctx } = repo(t);
  const base = commitFiles(dir, {
    [NESTED]: MANIFEST,
    "packages/b/package.json": MANIFEST,
    "packages/c/package.json": "{ not json",
  });
  const head = commitFiles(
    dir,
    {
      [NESTED]: CHANGED,
      "packages/c/package.json": MANIFEST,
      "packages/d/package.json": "{ not json",
    },
    base,
  );
  assert.deepEqual(await stateAt(ctx, base, "packages/d/package.json", dir), {
    kind: "absent",
  });
  assert.deepEqual(await stateAt(ctx, head, NESTED, dir), {
    kind: "regular",
    mode: "100644",
    text: CHANGED,
  });
  const before = await readChanges(ctx, base, head, dir);
  assert.deepEqual(checkChanges(before), [
    'packages/a/package.json: the "test" script',
    "packages/b/package.json (removed)",
    // Invalid on the base side: nothing to compare against.
    'packages/c/package.json: the "test" script',
    "packages/d/package.json isn't valid JSON here, so the judge can't tell whether it changes the checks",
  ]);

  // A blob git can't produce, as in a damaged or partial clone.
  deleteObject(dir, writeBlob(dir, CHANGED));
  const state = await stateAt(ctx, head, NESTED, dir);
  assert.equal(state.kind, "unreadable");
  const after = await readChanges(ctx, base, head, dir);
  assert.match(
    checkChanges(after)[0] ?? "",
    /^packages\/a\/package\.json \(could not read it here: git cat-file failed: /,
  );
  // On the base side too.
  deleteObject(dir, writeBlob(dir, MANIFEST));
  assert.match(
    checkChanges(await readChanges(ctx, base, head, dir)).join("\n"),
    /packages\/b\/package\.json \(could not read it on the base branch: /,
  );
  // A commit git doesn't have is unreadable, not absent.
  assert.equal(
    (await stateAt(ctx, "7".repeat(40), NESTED, dir)).kind,
    "unreadable",
  );
});

void test("paths git would quote are read exactly: non-ASCII, a quote, a tab and a newline", async (t) => {
  const { dir, ctx } = repo(t);
  const odd = 'packages/é "q"\tt\nn/package.json';
  const base = commitFiles(dir, { [odd]: MANIFEST, "src/a.ts": "a" });
  const head = commitFiles(dir, { [odd]: CHANGED, "src/a.ts": "b" }, base);
  assert.deepEqual(await changedPaths(ctx, base, head, dir), [odd, "src/a.ts"]);
  assert.deepEqual(checkChanges(await readChanges(ctx, base, head, dir)), [
    `${odd}: the "test" script`,
  ]);
});

/** A context whose git answers `ls-tree` with `listing` and `cat-file`
 * with `blob`. */
function scripted(listing: GitResult, blob?: GitResult) {
  const git = createFakeGit((args) =>
    args.includes("ls-tree")
      ? listing
      : (blob ?? { code: 0, stdout: MANIFEST, stderr: "" }),
  );
  return { git, ctx: createFakeContext({ git }) };
}

const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: "" });
const ID = "8".repeat(40);

void test("ls-tree's answer is trusted only when it is the one entry asked for", async () => {
  const unreadable: [string, GitResult][] = [
    ["the wrong path", ok(`100644 blob ${ID}\tpackages/b/package.json\0`)],
    [
      "two entries",
      ok(`100644 blob ${ID}\t${NESTED}\x00100644 blob ${ID}\t${NESTED}\x00`),
    ],
    ["no closing NUL", ok(`100644 blob ${ID}\t${NESTED}`)],
    ["a mode and type that don't match", ok(`100644 tree ${ID}\t${NESTED}\0`)],
    ["an unknown mode", ok(`100600 blob ${ID}\t${NESTED}\0`)],
    ["a short id", ok(`100644 blob 1234\t${NESTED}\0`)],
    ["no tab", ok(`100644 blob ${ID} ${NESTED}\0`)],
    ["a failure", { code: 128, stdout: "", stderr: "fatal: bad tree" }],
  ];
  // A path no tree can hold, asked for and answered exactly.
  const dodging = "node_modules/../packages/a/package.json";
  assert.equal(
    (
      await stateAt(
        scripted(ok(`100644 blob ${ID}\t${dodging}\0`)).ctx,
        "base",
        dodging,
        "/repo",
      )
    ).kind,
    "unreadable",
    "a path with ..",
  );
  for (const [what, answer] of unreadable) {
    const { ctx } = scripted(answer);
    assert.equal(
      (await stateAt(ctx, "base", NESTED, "/repo")).kind,
      "unreadable",
      what,
    );
  }
  assert.deepEqual(await stateAt(scripted(ok("")).ctx, "b", NESTED, "/repo"), {
    kind: "absent",
  });
});

void test("an entry that isn't a regular file is never read as a blob", async () => {
  for (const line of [
    `040000 tree ${ID}\t${NESTED}\0`,
    `160000 commit ${ID}\t${NESTED}\0`,
    `120000 blob ${ID}\t${NESTED}\0`,
  ]) {
    const { ctx, git } = scripted(ok(line));
    const state = await stateAt(ctx, "head", NESTED, "/repo");
    assert.equal(state.kind, "special", line);
    assert.ok(
      git.calls.every((call) => call.args[0] !== "cat-file"),
      line,
    );
  }
});

void test("a regular file whose blob git can't read is unreadable; one whose text isn't needed isn't read", async () => {
  const listing = ok(`100644 blob ${ID}\t${NESTED}\0`);
  const failed = scripted(listing, { code: 128, stdout: "", stderr: "bad" });
  assert.equal(
    (await stateAt(failed.ctx, "head", NESTED, "/repo")).kind,
    "unreadable",
  );
  const npmrc = scripted(ok(`100644 blob ${ID}\t.npmrc\0`));
  assert.deepEqual(await stateAt(npmrc.ctx, "head", ".npmrc", "/repo"), {
    kind: "regular",
    mode: "100644",
  });
  assert.ok(npmrc.git.calls.every((call) => call.args[0] !== "cat-file"));
});

void test("the changed paths come NUL-separated from a diff that takes no defaults from git's config", async () => {
  const git = createFakeGit(() => ok(" lead.txt\0a\nb.txt\0"));
  const ctx = createFakeContext({ git });
  assert.deepEqual(await changedPaths(ctx, "b", "h", "/repo"), [
    " lead.txt",
    "a\nb.txt",
  ]);
  assert.deepEqual(git.calls[0]?.args, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-relative",
    "--ignore-submodules=none",
    "--no-ext-diff",
    "--no-color",
    "b...h",
  ]);
});
