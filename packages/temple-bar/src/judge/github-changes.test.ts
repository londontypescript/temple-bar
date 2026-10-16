// The judge's reading of GitHub when it succeeds: two fixed commits, their
// whole trees and only the changed guarded blobs, against a fake GitHub
// answering from a real git repository. The failures are in
// github-fail-closed.test.ts.

import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext } from "../testing/fakes.ts";
import { commitFiles, writeBlob } from "../testing/git-commits.ts";
import { API, githubFromGit } from "../testing/github-from-git.ts";
import { findCheckChanges } from "./changes.ts";
import { readFixedChanges } from "./github-changes.ts";
import {
  BASE,
  blobUrl,
  CHANGED_MANIFEST,
  CODE_ONLY,
  MANIFEST,
  NESTED_CHANGE,
  newRepo,
  PR,
  setup,
  treeUrl,
} from "./testing/trees.ts";

void test("a pull request changing only code inside packages leaves every guarded path alone", async (t) => {
  const { read, http } = setup(t, CODE_ONLY);
  const result = await read();
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.deepEqual(result.value.changes, []);
  // No guarded file changed, so no blob is read at all.
  assert.ok(http.calls.every((call) => !call.url.includes("/git/blobs/")));
  assert.ok(http.calls.every((call) => call.token === "t0ken"));
});

void test("a manifest added with no scripts passes; one with scripts is a finding", async (t) => {
  const bare = await setup(t, {
    ...BASE,
    "packages/b/package.json": JSON.stringify({ name: "b" }),
  }).read();
  assert.ok(bare.ok);
  assert.deepEqual(findCheckChanges(bare.value.changes), []);

  const scripted = await setup(t, {
    ...BASE,
    "packages/b/package.json": MANIFEST,
  }).read();
  assert.ok(scripted.ok);
  assert.deepEqual(findCheckChanges(scripted.value.changes), [
    "packages/b/package.json (added, with scripts)",
  ]);
});

void test("manifests and the lockfile are read from the same two trees, through wrapped base64", async (t) => {
  const lockfile = `lockfileVersion: '9.0'\n${"# a long line to wrap\n".repeat(20)}`;
  const { read, http, dir, baseSha, headSha } = setup(t, {
    ...NESTED_CHANGE,
    "pnpm-lock.yaml": lockfile,
  });
  const result = await read();
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.value.baseSha, baseSha);
  assert.equal(result.value.headSha, headSha);
  assert.deepEqual(findCheckChanges(result.value.changes), [
    'packages/a/package.json: the "test" script',
  ]);
  const lock = result.value.changes.find((c) => c.path === "pnpm-lock.yaml");
  assert.deepEqual(lock?.head, {
    kind: "regular",
    mode: "100644",
    text: lockfile,
  });
  // The four blobs read are exactly the two sides of the two changed files.
  const expected = [
    MANIFEST,
    CHANGED_MANIFEST,
    "lockfileVersion: '9.0'\n",
    lockfile,
  ]
    .map((text) => blobUrl(writeBlob(dir, text)))
    .sort();
  const blobs = http.calls
    .map((call) => call.url)
    .filter((url) => url.includes("/git/blobs/"))
    .sort();
  assert.deepEqual(blobs, expected);
  // Trees are read by commit, never by branch name, and never through the
  // contents API.
  const trees = http.calls.filter((call) => call.url.includes("/git/trees/"));
  assert.deepEqual(
    trees.map((call) => call.url),
    [treeUrl(baseSha), treeUrl(headSha)],
  );
  assert.ok(http.calls.every((call) => !call.url.includes("/contents/")));
});

void test("a manifest made a symlink is refused, and still refused once it is on the base branch", async (t) => {
  const first = setup(t, {
    ...BASE,
    "shared/a.json": MANIFEST,
    "packages/a/package.json": { symlink: "../../shared/a.json" },
  });
  const result = await first.read();
  assert.ok(result.ok);
  assert.deepEqual(findCheckChanges(result.value.changes), [
    "packages/a/package.json (not a regular file)",
  ]);
  // The symlink itself is never read as the manifest's text.
  const symlinkBlob = writeBlob(first.dir, "../../shared/a.json");
  assert.ok(
    first.http.calls.every((call) => call.url !== blobUrl(symlinkBlob)),
  );

  // A symlink already on the base branch is still refused when a pull
  // request changes only its target, which no guard covers by name.
  const linked = {
    ...BASE,
    "shared/a.json": MANIFEST,
    "packages/a/package.json": { symlink: "../../shared/a.json" },
  };
  const second = await setup(
    t,
    { ...linked, "shared/a.json": CHANGED_MANIFEST },
    {},
    linked,
  ).read();
  assert.ok(second.ok);
  assert.deepEqual(findCheckChanges(second.value.changes), [
    "packages/a/package.json (not a regular file)",
  ]);
});

void test("a change of mode on a guarded file is a finding", async (t) => {
  const result = await setup(t, {
    ...BASE,
    "packages/a/package.json": { text: MANIFEST, executable: true },
  }).read();
  assert.ok(result.ok);
  assert.deepEqual(findCheckChanges(result.value.changes), [
    "packages/a/package.json (mode changed from 100644 to 100755)",
  ]);
});

void test("a submodule or a folder at a guarded path is judged without fetching any blob", async (t) => {
  const { read, http } = setup(t, {
    ...BASE,
    "packages/c/package.json": { submodule: "1".repeat(40) },
    "packages/d/package.json/index.ts": "export {};\n",
  });
  const result = await read();
  assert.ok(result.ok);
  assert.deepEqual(findCheckChanges(result.value.changes), [
    "packages/c/package.json (not a regular file)",
    "packages/d/package.json (not a regular file)",
  ]);
  assert.ok(http.calls.every((call) => !call.url.includes("/git/blobs/")));
});

void test("a base branch whose name has a slash is asked for with the slash kept and answered exactly", async (t) => {
  const { read, http } = setup(t, CODE_ONLY, {
    baseRefs: ["feature/über"],
  });
  const result = await read();
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.value.baseRef, "feature/über");
  assert.ok(
    http.calls.some(
      (call) => call.url === `${API}/git/ref/heads/feature/%C3%BCber`,
    ),
  );
});

void test("a head that goes A, B and back to A is judged as commit A, the one both reads name", async (t) => {
  // While the judge reads, the head is briefly B, which changes no guarded
  // file. Both reads of the pull request say A, and A's own tree is read,
  // so A's change is seen: a list of changed files read meanwhile could
  // have described B instead.
  const dir = newRepo(t);
  const baseSha = commitFiles(dir, BASE);
  const a = commitFiles(dir, NESTED_CHANGE, baseSha);
  const b = commitFiles(dir, CODE_ONLY, baseSha);
  const http = githubFromGit({ dir, heads: [a, a], tips: [baseSha] });
  const result = await readFixedChanges(createFakeContext({ http }), PR);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.deepEqual(findCheckChanges(result.value.changes), [
    'packages/a/package.json: the "test" script',
  ]);
  assert.ok(http.calls.every((call) => !call.url.includes(b)));
});
