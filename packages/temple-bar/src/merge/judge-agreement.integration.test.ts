// The judge, `ready` and `merge` name the same changes for the same diff.
// Each case is two real commits, judged twice: by the local reader `ready`
// and `merge` share (git), and by the judge's GitHub reader against a fake
// GitHub answering from the same repository (trees and blobs). Both must
// give exactly the expected findings, renames included.

import assert from "node:assert/strict";
import test from "node:test";

import {
  judgeBoth,
  assertAgree,
  type AgreementCase,
} from "../judge/testing/agreement.ts";
import { newRepo } from "../judge/testing/trees.ts";
import {
  commitFiles,
  deleteObject,
  writeBlob,
} from "../testing/git-commits.ts";

const A = JSON.stringify({ name: "a", scripts: { test: "node --test" } });
const B = JSON.stringify({ name: "b", scripts: { lint: "eslint ." } });
const ROOT = JSON.stringify({ name: "root", scripts: { test: "x" } });

const cases: readonly AgreementCase[] = [
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
    "a folder at a guarded path deleted",
    { "packages/a/.npmrc/payload.txt": "x\n" },
    {},
    ["packages/a/.npmrc (removed)"],
  ],
  [
    "a folder under .github/workflows/, unchanged",
    { ".github/workflows/sub/a.yml": "name: A\n" },
    { ".github/workflows/sub/a.yml": "name: A\n" },
    [],
  ],
  [
    "a file changed inside a folder under .github/workflows/",
    { ".github/workflows/sub/a.yml": "name: A\n" },
    { ".github/workflows/sub/a.yml": "name: B\n" },
    [".github/workflows/sub/a.yml (modified)"],
  ],
  [
    "a workflow file made a folder",
    { ".github/workflows/sub": "name: A\n" },
    { ".github/workflows/sub/a.yml": "name: A\n" },
    [".github/workflows/sub (removed)", ".github/workflows/sub/a.yml (added)"],
  ],
  [
    "a symlink under .github/workflows/, unchanged",
    {
      ".github/workflows/a.yml": { symlink: "../../ci/a.yml" },
      "ci/a.yml": "x",
    },
    {
      ".github/workflows/a.yml": { symlink: "../../ci/a.yml" },
      "ci/a.yml": "y",
    },
    [".github/workflows/a.yml (not a regular file)"],
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

for (const one of cases) {
  void test(`judge, ready and merge agree: ${one[0]}`, async (t) => {
    await assertAgree(t, [one]);
  });
}

/** A manifest's text with `bytes` in the middle of a string value. */
const withBytes = (...bytes: number[]) => ({
  bytes: Buffer.concat([
    Buffer.from('{"name":"a","description":"'),
    Buffer.from(bytes),
    Buffer.from('","scripts":{"test":"node --test"}}'),
  ]),
});

const NOT_UTF8 = "could not read it here: it isn't valid UTF-8";

void test("judge, ready and merge read every text as UTF-8 from its bytes, and agree on what isn't", async (t) => {
  const nested = "packages/a/package.json";
  await assertAgree(t, [
    [
      "a stray byte",
      { [nested]: A },
      { [nested]: withBytes(0xff) },
      [`${nested} (${NOT_UTF8})`],
    ],
    [
      "a lone continuation byte",
      { [nested]: A },
      { [nested]: withBytes(0x80) },
      [`${nested} (${NOT_UTF8})`],
    ],
    [
      "an overlong form",
      { [nested]: A },
      { [nested]: withBytes(0xc0, 0xaf) },
      [`${nested} (${NOT_UTF8})`],
    ],
    [
      "a surrogate pair encoded as two three-byte forms",
      { [nested]: A },
      { [nested]: withBytes(0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80) },
      [`${nested} (${NOT_UTF8})`],
    ],
    [
      "on the base branch",
      { [nested]: withBytes(0xff) },
      { [nested]: A },
      [
        `${nested} (could not read it on the base branch: it isn't valid UTF-8)`,
      ],
    ],
    // U+FFFD is valid text when its own bytes are there.
    [
      "U+FFFD as valid bytes",
      { [nested]: A },
      { [nested]: withBytes(0xef, 0xbf, 0xbd) },
      [],
    ],
    [
      "a byte order mark, which neither reader drops",
      { [nested]: A },
      {
        [nested]: {
          bytes: Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(B),
          ]),
        },
      },
      [
        `${nested} isn't valid JSON here, so the judge can't tell whether it changes the checks`,
      ],
    ],
    [
      "the root lockfile",
      { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
      { "pnpm-lock.yaml": { bytes: Buffer.from([0x6c, 0xff, 0x0a]) } },
      [`pnpm-lock.yaml (${NOT_UTF8})`],
    ],
  ]);
});

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
