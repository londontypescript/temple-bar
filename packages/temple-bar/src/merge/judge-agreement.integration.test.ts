// The judge, `ready` and `merge` name the same changes for the same diff.
// Each case is two real commits, judged twice: by the local reader `ready`
// and `merge` share (git), and by the judge's GitHub reader against a fake
// GitHub answering from the same repository (trees and blobs). Both must
// give exactly the expected findings, renames included.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { findCheckChanges } from "../judge/changes.ts";
import { readFixedChanges } from "../judge/github-changes.ts";
import { createGitSeam } from "../seams/git.ts";
import { createFakeContext } from "../testing/fakes.ts";
import {
  commitFiles,
  deleteObject,
  writeBlob,
  type RepoFile,
} from "../testing/git-commits.ts";
import { initTestRepo } from "../testing/git-repo.ts";
import { githubFromGit } from "../testing/github-from-git.ts";
import { checkChanges } from "./approval.ts";
import { readChanges } from "./manifests.ts";

type Files = Readonly<Record<string, RepoFile>>;

const A = JSON.stringify({ name: "a", scripts: { test: "node --test" } });
const B = JSON.stringify({ name: "b", scripts: { lint: "eslint ." } });
const ROOT = JSON.stringify({ name: "root", scripts: { test: "x" } });

const PR = {
  api: "https://api.github.com",
  owner: "acme",
  repo: "widgets",
  number: 7,
  token: "t",
};

function newRepo(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "temple-bar-agreement-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  initTestRepo(dir);
  return dir;
}

/** Both readers' findings for the change from `base` to `head`, and what
 * the judge's read gave when it didn't succeed. */
async function judgeBoth(dir: string, baseSha: string, headSha: string) {
  const local = createFakeContext({ git: createGitSeam(), cwd: dir });
  const byGit = checkChanges(await readChanges(local, baseSha, headSha, dir));
  const http = githubFromGit({ dir, heads: [headSha], tips: [baseSha] });
  const read = await readFixedChanges(createFakeContext({ http }), PR);
  return {
    byGit,
    byGitHub: read.ok ? findCheckChanges(read.value.changes) : read.reason,
  };
}

async function assertAgree(
  t: TestContext,
  base: Files,
  head: Files,
  expected: readonly string[],
): Promise<void> {
  const dir = newRepo(t);
  const baseSha = commitFiles(dir, { "src/x.ts": "1", ...base });
  const headSha = commitFiles(dir, { "src/x.ts": "2", ...head }, baseSha);
  const { byGit, byGitHub } = await judgeBoth(dir, baseSha, headSha);
  assert.deepEqual(byGit, expected, "ready and merge");
  assert.deepEqual(byGitHub, expected, "the judge");
}

const cases: readonly [string, Files, Files, readonly string[]][] = [
  [
    "a nested manifest's script",
    { "packages/a/package.json": A },
    { "packages/a/package.json": B },
    [
      'packages/a/package.json: the "lint" script',
      'packages/a/package.json: the "test" script',
    ],
  ],
  [
    "a manifest renamed to another manifest",
    { "packages/a/package.json": A },
    { "packages/z/package.json": A },
    [
      "packages/a/package.json (removed)",
      "packages/z/package.json (added, with scripts)",
    ],
  ],
  [
    "a manifest renamed to an ordinary file",
    { "packages/a/package.json": A },
    { "packages/a/package.json.bak": A },
    ["packages/a/package.json (removed)"],
  ],
  [
    "an ordinary file renamed to a manifest",
    { "packages/a/manifest.json": A },
    { "packages/a/package.json": A },
    ["packages/a/package.json (added, with scripts)"],
  ],
  [
    "a manifest moved into node_modules",
    { "packages/a/package.json": A },
    { "node_modules/a/package.json": A },
    ["packages/a/package.json (removed)"],
  ],
  [
    "a manifest moved out of node_modules",
    { "node_modules/a/package.json": A },
    { "packages/a/package.json": A },
    ["packages/a/package.json (added, with scripts)"],
  ],
  [
    "a case-only rename",
    { "packages/a/package.json": A },
    { "packages/a/Package.json": A },
    [
      "packages/a/Package.json (added, with scripts)",
      "packages/a/package.json (removed)",
    ],
  ],
  [
    "a chain of renames",
    { "packages/a/package.json": A, "packages/b/package.json": B },
    { "packages/b/package.json": A, "packages/c/package.json": B },
    [
      "packages/a/package.json (removed)",
      'packages/b/package.json: the "lint" script',
      'packages/b/package.json: the "test" script',
      "packages/c/package.json (added, with scripts)",
    ],
  ],
  [
    "an old path reused",
    { "packages/a/package.json": A },
    { "packages/a/package.json": B, "packages/z/package.json": A },
    [
      'packages/a/package.json: the "lint" script',
      'packages/a/package.json: the "test" script',
      "packages/z/package.json (added, with scripts)",
    ],
  ],
  [
    "an install setting at depth, in any case",
    { "packages/a/.npmrc": "a=1\n" },
    { "packages/a/.npmrc": "a=2\n", "packages/b/.NPMRC": "b=1\n" },
    ["packages/a/.npmrc (modified)", "packages/b/.NPMRC (added)"],
  ],
  [
    "a root field",
    { "package.json": ROOT },
    {
      "package.json": JSON.stringify({
        ...JSON.parse(ROOT),
        packageManager: "pnpm@9.0.0",
      }),
    },
    ['package.json: the "packageManager" field'],
  ],
  [
    "a manifest made a symlink",
    { "packages/a/package.json": A },
    {
      "packages/a/package.json": { symlink: "../../shared.json" },
      "shared.json": A,
    },
    ["packages/a/package.json (not a regular file)"],
  ],
  [
    "a manifest already a symlink on the base branch, its target changed",
    {
      "packages/a/package.json": { symlink: "../../shared.json" },
      "shared.json": A,
    },
    {
      "packages/a/package.json": { symlink: "../../shared.json" },
      "shared.json": B,
    },
    ["packages/a/package.json (not a regular file)"],
  ],
  [
    "a folder named package.json added",
    {},
    { "packages/a/package.json/README.md": "not a manifest\n" },
    ["packages/a/package.json (not a regular file)"],
  ],
  [
    "an invalid manifest",
    { "packages/a/package.json": A },
    { "packages/a/package.json": "{ not json" },
    [
      "packages/a/package.json isn't valid JSON here, so the judge can't tell whether it changes the checks",
    ],
  ],
  [
    "a manifest whose path git would quote",
    { 'packages/é "q"\tt\nn/package.json': A },
    { 'packages/é "q"\tt\nn/package.json': B },
    [
      'packages/é "q"\tt\nn/package.json: the "lint" script',
      'packages/é "q"\tt\nn/package.json: the "test" script',
    ],
  ],
  [
    "only code inside packages, with guarded files on both sides",
    { "package.json": ROOT, "packages/a/package.json": A, ".npmrc": "x\n" },
    { "package.json": ROOT, "packages/a/package.json": A, ".npmrc": "x\n" },
    [],
  ],
];

for (const [what, base, head, expected] of cases) {
  void test(`judge, ready and merge agree: ${what}`, async (t) => {
    await assertAgree(t, base, head, expected);
  });
}

void test("judge, ready and merge agree on a manifest that can't be read: none of them passes it", async (t) => {
  const dir = newRepo(t);
  const baseSha = commitFiles(dir, { "packages/a/package.json": A });
  const headSha = commitFiles(dir, { "packages/a/package.json": B }, baseSha);
  deleteObject(dir, writeBlob(dir, B));
  const { byGit, byGitHub } = await judgeBoth(dir, baseSha, headSha);
  assert.match(
    byGit.join("\n"),
    /^packages\/a\/package\.json \(could not read it here: git cat-file failed/,
  );
  // GitHub has no unreadable file: the judge as a whole can't read the
  // pull request, which fails it.
  assert.equal(typeof byGitHub, "string");
  assert.match(String(byGitHub), /GitHub answered 404/);
});
