import assert from "node:assert/strict";
import test from "node:test";

import { createFakeContext, createFakeGit } from "../testing/fakes.ts";
import { measureDiff, parseNumstat } from "./diff.ts";

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
  assert.deepEqual(size, { linesChanged: 16, filesTouched: 3 });
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
