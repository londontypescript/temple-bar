import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { isTestPath, measureDiff, parseNumstat } from "./diff.ts";

const NUMSTAT = [
  "10\t2\tsrc/a.ts\0",
  "2000\t0\tpnpm-lock.yaml\0",
  "0\t0\t\0old.ts\0moved.ts\0",
  "3\t1\t\0before.ts\0after.ts\0",
  "-\t-\timage.png\0",
  "40\t0\tdist/gen.js\0",
].join("");

void test("parseNumstat reads plain, renamed and binary entries", () => {
  assert.deepEqual(parseNumstat(NUMSTAT), [
    { path: "src/a.ts", lines: 12, renamed: false },
    { path: "pnpm-lock.yaml", lines: 2000, renamed: false },
    { path: "moved.ts", lines: 0, renamed: true },
    { path: "after.ts", lines: 4, renamed: true },
    { path: "image.png", lines: 0, renamed: false },
    { path: "dist/gen.js", lines: 40, renamed: false },
  ]);
});

void test("measureDiff skips lockfiles, pure renames and linguist-generated files", async () => {
  const git = createFakeGit((args) =>
    args[0] === "diff"
      ? { code: 0, stdout: NUMSTAT, stderr: "" }
      : {
          code: 0,
          stdout:
            "dist/gen.js\0linguist-generated\0set\0src/a.ts\0linguist-generated\0unspecified\0",
          stderr: "",
        },
  );
  const size = await measureDiff(
    createFakeContext({ git }),
    "origin/main",
    "HEAD",
  );
  // src/a.ts (12) + after.ts (4) + image.png (0, still a file touched)
  assert.deepEqual(size, { sourceLines: 16, testLines: 0, filesTouched: 3 });
  assert.equal(git.calls[0]?.args.includes("origin/main...HEAD"), true);
});

void test("measureDiff fails loudly when git does, rather than measuring nothing", async () => {
  const git = createFakeGit(() => ({
    code: 128,
    stdout: "",
    stderr: "fatal: bad revision",
  }));
  await assert.rejects(
    measureDiff(createFakeContext({ git }), "nope", "HEAD"),
    /bad revision/,
  );
});

void test("isTestPath knows a test by its name, never by its folder", () => {
  for (const file of [
    "src/a.test.ts",
    "a.spec.js",
    "src/deep/b.test.tsx",
    "src/__tests__/helper.ts",
    "__tests__/x.js",
    "src/__snapshots__/a.test.ts.snap",
    "ui/view.snap",
  ]) {
    assert.equal(isTestPath(file), true, file);
  }
  // Code under fixtures/, test/ or testing/ is still code, so it can't
  // escape the source limit there; only a file's own name makes it a test.
  for (const file of [
    "src/a.ts",
    "fixtures/a.ts",
    "test/helpers.ts",
    "src/testing/world.ts",
    "src/latest.ts",
    "src/contest.ts",
    "src/a.test",
    "src/snap.ts",
    "src/__tests__x/a.ts",
  ]) {
    assert.equal(isTestPath(file), false, file);
  }
});

void test("measureDiff counts source and test lines apart, and files together", async () => {
  const numstat = [
    "10\t2\tsrc/a.ts\0",
    "30\t5\tsrc/a.test.ts\0",
    "7\t0\tsrc/__snapshots__/a.test.ts.snap\0",
    "4\t0\tfixtures/case.ts\0",
    // An edited rename counts as a test or not by its new name.
    "2\t1\t\0src/old.ts\0src/old.test.ts\0",
    "600\t0\tpackages/x/pnpm-lock.yaml\0",
  ].join("");
  const git = createFakeGit((args) => ({
    code: 0,
    stdout: args[0] === "diff" ? numstat : "",
    stderr: "",
  }));
  const size = await measureDiff(
    createFakeContext({ git }),
    "origin/main",
    "HEAD",
  );
  assert.deepEqual(size, { sourceLines: 16, testLines: 45, filesTouched: 5 });
});
