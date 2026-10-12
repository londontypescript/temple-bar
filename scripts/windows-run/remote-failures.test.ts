import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  fakeSys,
  lastRecord,
  RUN_ID,
  RUNNER_START,
  SHA,
  tempDir,
} from "./testing.ts";
import { runRemote } from "./remote/runner.ts";

const ROOT = "temple-bar-windows-run";

function lockWith(home: string, owner: object): string {
  const lock = path.join(home, ROOT, "lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner));
  return lock;
}

void test("a failed process listing fails the run closed at every caller", async (t) => {
  // Listings: 1 start, 2 sweep, 3 after install, 4 after check, 5 after
  // build, 6 final cleanup.
  const cases: { from: number; steps: string[]; refusal: string }[] = [
    { from: 1, steps: [], refusal: "runner-error" },
    { from: 2, steps: [], refusal: "runner-error" },
    { from: 3, steps: ["install"], refusal: "runner-error" },
  ];
  for (const { from, steps, refusal } of cases) {
    const sys = fakeSys({ home: tempDir(t), failListingFrom: from });
    assert.equal(await runRemote(RUN_ID, SHA, sys), 1, `from ${String(from)}`);
    assert.deepEqual(sys.stepsRun, steps);
    assert.equal(lastRecord(sys.printed).refusal, refusal);
    assert.equal(sys.killed.length, 0);
  }
});

void test("a failed listing never reads a live lock holder as dead", async (t) => {
  const home = tempDir(t);
  const lock = lockWith(home, {
    pid: 555,
    startMs: RUNNER_START - 60_000,
    runId: "deadbeef",
  });
  const sys = fakeSys({ home, failListingFrom: 2 });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  assert.equal(lastRecord(sys.printed).refusal, "runner-error");
  assert.doesNotMatch(sys.printed, /took over/);
  assert.ok(existsSync(path.join(lock, "owner.json")));
});

void test("a listing that fails during final cleanup is reported and the result stands", async (t) => {
  const sys = fakeSys({ home: tempDir(t), failListingFrom: 6 });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.match(
    lastRecord(sys.printed).cleanup.join(" "),
    /could not list processes/,
  );
});

void test("the log is flushed before its problem is read, and a failed lock release keeps it", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({ home });
  const realAppend = sys.fs.appendFile.bind(sys.fs);
  sys.fs.appendFile = () => Promise.reject(new Error("disk full"));
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.match(
    lastRecord(sys.printed).cleanup.join(" "),
    /log could not be written/,
  );
  sys.fs.appendFile = realAppend;

  const home2 = tempDir(t);
  const sys2 = fakeSys({ home: home2 });
  const realRm = sys2.fs.rm.bind(sys2.fs);
  const lock = path.join(home2, ROOT, "lock");
  sys2.fs.rm = (target) =>
    target === lock ? Promise.reject(new Error("locked")) : realRm(target);
  assert.equal(await runRemote(RUN_ID, SHA, sys2), 0);
  assert.match(
    lastRecord(sys2.printed).cleanup.join(" "),
    /could not release the lock/,
  );
  assert.ok(existsSync(path.join(home2, ROOT, "logs", `${RUN_ID}.log`)));
});

void test("a runner error keeps the log", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({ home, failListingFrom: 3 });
  await runRemote(RUN_ID, SHA, sys);
  assert.ok(existsSync(path.join(home, ROOT, "logs", `${RUN_ID}.log`)));
});

void test("a failed core.longpaths stops the checkout, and a failed prune is reported", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    failGit: (args) => args.startsWith("config core.longpaths"),
  });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  assert.equal(lastRecord(sys.printed).refusal, "fetch-failed");
  assert.deepEqual(sys.stepsRun, []);

  const pruning = fakeSys({
    home: tempDir(t),
    failGit: (args) => args.startsWith("worktree prune"),
  });
  assert.equal(await runRemote(RUN_ID, SHA, pruning), 0);
  assert.match(
    lastRecord(pruning.printed).cleanup.join(" "),
    /worktree prune failed/,
  );
});
