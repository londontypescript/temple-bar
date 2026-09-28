import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
} from "../testing/fakes.ts";
import {
  checkFileLengths,
  collectLineCounts,
  countLines,
  DEFAULT_MAX_FILE_LINES,
  findOverCapFiles,
  isSkippableLengthPath,
  listGitPaths,
  looksBinary,
  readMaxFileLines,
} from "./lengths.ts";

void test("countLines counts a trailing newline as the end of the last line, not an extra one", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb\nc\n"), 3);
  assert.equal(countLines("a\nb\nc"), 3);
});

void test("findOverCapFiles keeps only entries over the cap, longest first", () => {
  const over = { path: "over.txt", lines: 6 };
  const at = { path: "at.txt", lines: 5 };
  const under = { path: "under.txt", lines: 1 };
  const longer = { path: "longer.txt", lines: 50 };

  assert.deepEqual(findOverCapFiles([over, at, under, longer], 5), [
    longer,
    over,
  ]);
});

void test("isSkippableLengthPath skips directory entries (nested worktrees, P3.7) and lockfiles", () => {
  assert.equal(isSkippableLengthPath("nested-worktree/"), true);
  assert.equal(isSkippableLengthPath("vendor/some-embedded-repo/"), true);
  assert.equal(isSkippableLengthPath("pnpm-lock.yaml"), true);
  assert.equal(isSkippableLengthPath("nested/dir/yarn.lock"), true);
  assert.equal(isSkippableLengthPath("src/index.ts"), false);
});

void test("looksBinary detects a NUL byte and leaves ordinary text alone", () => {
  assert.equal(looksBinary("hello\0world"), true);
  assert.equal(looksBinary("hello world"), false);
});

void test("readMaxFileLines uses the config's maxFileLines when present", async () => {
  const ctx = createFakeContext({
    fs: createFakeFs({
      "/repo/temple-bar.config.json": JSON.stringify({ maxFileLines: 123 }),
    }),
  });
  assert.equal(await readMaxFileLines(ctx), 123);
});

void test("readMaxFileLines falls back to the package default with no config file", async () => {
  const ctx = createFakeContext({ fs: createFakeFs() });
  assert.equal(await readMaxFileLines(ctx), DEFAULT_MAX_FILE_LINES);
});

void test("readMaxFileLines falls back to the default only when the key is absent", async () => {
  const noKey = createFakeContext({
    fs: createFakeFs({ "/repo/temple-bar.config.json": JSON.stringify({}) }),
  });
  assert.equal(await readMaxFileLines(noKey), DEFAULT_MAX_FILE_LINES);
});

void test("readMaxFileLines rejects a broken config instead of silently loosening the cap", async () => {
  for (const content of [
    "{ not json",
    JSON.stringify({ maxFileLines: "300" }),
    JSON.stringify({ maxFileLines: 0 }),
    JSON.stringify({ maxFileLines: 12.5 }),
    JSON.stringify([]),
  ]) {
    const ctx = createFakeContext({
      fs: createFakeFs({ "/repo/temple-bar.config.json": content }),
    });
    await assert.rejects(readMaxFileLines(ctx), /temple-bar\.config\.json/);
  }
});

void test("listGitPaths treats a failed git ls-files as an error, never as zero files", async () => {
  const ctx = createFakeContext({
    git: createFakeGit(() => ({
      code: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    })),
  });
  await assert.rejects(listGitPaths(ctx), /not a git repository/);
});

void test("collectLineCounts skips lockfiles, directory entries, and binary files, and counts the rest", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: [
      "src/index.ts",
      "pnpm-lock.yaml",
      "nested-worktree/",
      "image.png",
      "gone.ts",
    ].join("\n"),
    stderr: "",
  }));
  const fs = createFakeFs({
    "/repo/src/index.ts": "a\nb\nc\n",
    "/repo/pnpm-lock.yaml": "irrelevant\n",
    "/repo/image.png": "\0binary",
  });
  // "gone.ts" is listed by git but absent from fs (readText resolves
  // undefined), simulating a staged rename.
  const ctx = createFakeContext({ git, fs });

  const counts = await collectLineCounts(ctx);

  assert.deepEqual(counts, [{ path: "src/index.ts", lines: 3 }]);
});

void test("checkFileLengths reports offenders over the configured cap", async () => {
  const git = createFakeGit(() => ({
    code: 0,
    stdout: "big.ts\nsmall.ts\n",
    stderr: "",
  }));
  const fs = createFakeFs({
    "/repo/temple-bar.config.json": JSON.stringify({ maxFileLines: 2 }),
    "/repo/big.ts": "1\n2\n3\n",
    "/repo/small.ts": "1\n",
  });
  const ctx = createFakeContext({ git, fs });

  const result = await checkFileLengths(ctx);

  assert.equal(result.maxLines, 2);
  assert.equal(result.totalChecked, 2);
  assert.deepEqual(result.offenders, [{ path: "big.ts", lines: 3 }]);
});
