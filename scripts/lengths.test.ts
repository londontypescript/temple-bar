import assert from "node:assert/strict";
import test from "node:test";
import { countLines, findOverCapFiles, isSkippable } from "./lengths.ts";

void test("countLines counts a trailing newline as the end of the last line, not an extra one", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb\nc\n"), 3);
  assert.equal(countLines("a\nb\nc"), 3);
});

void test("findOverCapFiles fails a fixture over the cap and passes one at or under it", () => {
  const maxLines = 5;
  const overCap: { path: string; lines: number } = {
    path: "over.txt",
    lines: 6,
  };
  const atCap: { path: string; lines: number } = { path: "at.txt", lines: 5 };
  const underCap: { path: string; lines: number } = {
    path: "under.txt",
    lines: 1,
  };

  const offenders = findOverCapFiles([overCap, atCap, underCap], maxLines);

  assert.deepEqual(offenders, [overCap]);
});

void test("findOverCapFiles sorts multiple offenders longest first", () => {
  const maxLines = 1;
  const short: { path: string; lines: number } = {
    path: "short.txt",
    lines: 2,
  };
  const long: { path: string; lines: number } = { path: "long.txt", lines: 10 };

  const offenders = findOverCapFiles([short, long], maxLines);

  assert.deepEqual(offenders, [long, short]);
});

void test("isSkippable skips known lockfiles regardless of content", () => {
  assert.equal(isSkippable("pnpm-lock.yaml", Buffer.from("anything")), true);
  assert.equal(
    isSkippable("nested/dir/yarn.lock", Buffer.from("anything")),
    true,
  );
});

void test("isSkippable skips binary-looking content and keeps text content", () => {
  assert.equal(isSkippable("image.png", Buffer.from([0, 1, 2, 3])), true);
  assert.equal(isSkippable("src/cli.ts", Buffer.from("hello world")), false);
});
