import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { RUN_ID, SHA, tempDir } from "./testing.ts";
import { nodeFs } from "./remote/fsx.ts";
import { LineBuffer } from "./remote/lines.ts";
import { acquireLock, releaseLock } from "./remote/lock.ts";
import { parseProcessList } from "./remote/processes.ts";
import { CheckScanner } from "./remote/scan.ts";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "remote");

void test("nothing in the runner's folder imports from outside it", () => {
  for (const file of readdirSync(here).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(here, file), "utf8");
    for (const match of source.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      const target = match[1] ?? "";
      assert.ok(
        target.startsWith("node:") || /^\.\/[^/]+$/.test(target),
        `${file} imports ${target}`,
      );
    }
  }
});

void test("lines split across chunks, multi-byte characters and CRLF are read whole", () => {
  const buffer = new LineBuffer();
  const bytes = Buffer.from("héllo wörld\r\nsecond\r\nlast");
  const cut = bytes.indexOf(0xc3) + 1; // in the middle of the first é
  const lines = [
    ...buffer.push(bytes.subarray(0, cut)),
    ...buffer.push(bytes.subarray(cut, 20)),
    ...buffer.push(bytes.subarray(20)),
    ...buffer.end(),
  ];
  assert.deepEqual(lines, ["héllo wörld", "second", "last"]);
});

void test("test totals and gate skips are read; ambiguity is unknown", () => {
  const scanner = new CheckScanner();
  for (const line of [
    "gate: checks:",
    "  passed   a",
    "  skipped  branch ruleset (origin is not on GitHub)",
    "gate: passed",
    "\u001b[34mℹ tests 10\u001b[39m",
    "ℹ pass 9",
    "ℹ fail 0",
    "ℹ skipped 1",
  ]) {
    scanner.feed(line);
  }
  assert.deepEqual(scanner.totals(), {
    tests: 10,
    passed: 9,
    failed: 0,
    skipped: 1,
    gateSkipped: 1,
    gateNoGithubOrigin: true,
  });
  scanner.feed("ℹ tests 3");
  assert.equal(scanner.totals().tests, "unknown");
  assert.equal(new CheckScanner().totals().gateSkipped, "unknown");
});

void test("the process list parses, and any line that does not fit spoils it", () => {
  assert.deepEqual(
    parseProcessList("12|node|1700000000000\r\n7|Sys|tem|\r\n\r\n"),
    [
      { pid: 12, name: "node", startMs: 1700000000000 },
      { pid: 7, name: "Sys|tem", startMs: null },
    ],
  );
  for (const garbled of ["bad", "|x|1", "x|node|1", "12|node|soon"]) {
    assert.equal(parseProcessList(`12|node|1\r\n${garbled}\r\n`), undefined);
  }
});

function lockDeps(alive: boolean) {
  return {
    fs: nodeFs,
    sleep: () => Promise.resolve(),
    isAlive: () => Promise.resolve(alive),
  };
}

void test("a run never releases another run's lock", async (t) => {
  const dir = path.join(tempDir(t), "lock");
  const deps = lockDeps(true);
  const mine = { pid: 1, startMs: 1, runId: RUN_ID };
  assert.equal((await acquireLock(deps, dir, mine)).kind, "acquired");
  assert.equal(await releaseLock(deps, dir, "ffffffff"), false);
  assert.equal(readdirSync(dir).includes("owner.json"), true);
  assert.equal(await releaseLock(deps, dir, RUN_ID), true);
  assert.equal(SHA.length, 40);
});

void test("a second run is refused while the first is alive", async (t) => {
  const dir = path.join(tempDir(t), "lock");
  const first = { pid: 1, startMs: 1, runId: RUN_ID };
  await acquireLock(lockDeps(true), dir, first);
  const second = await acquireLock(lockDeps(true), dir, {
    ...first,
    runId: "bbbbbbbb",
  });
  assert.equal(second.kind, "held");
  const third = await acquireLock(lockDeps(false), dir, {
    ...first,
    runId: "cccccccc",
  });
  assert.equal(third.kind, "acquired");
  await releaseLock(lockDeps(true), dir, "cccccccc");
});
