import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
import { judge } from "./verdict.ts";

const ROOT = "temple-bar-windows-run";

function checkLines(): string[] {
  return [
    "gate: checks:",
    "  passed   core setup",
    "  skipped  branch ruleset (origin is not on GitHub)",
    "  skipped  judge ruleset (origin is not on GitHub)",
    "gate: passed",
    "ℹ tests 12",
    "ℹ pass 11",
    "ℹ fail 0",
    "ℹ skipped 1",
  ];
}

void test("a passing run runs the three steps, indented, and prints the record last", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({
    home,
    steps: { check: { lines: [...checkLines(), "windows-run result x: {}"] } },
  });
  const code = await runRemote(RUN_ID, SHA, sys);
  assert.equal(code, 0);
  assert.deepEqual(sys.stepsRun, ["install", "check", "build"]);
  const record = lastRecord(sys.printed);
  assert.equal(record.refusal, null);
  assert.deepEqual(
    record.steps.map((step) => step.status),
    ["passed", "passed", "passed"],
  );
  assert.deepEqual(record.tests, {
    tests: 12,
    passed: 11,
    failed: 0,
    skipped: 1,
  });
  assert.deepEqual(record.gate, { skipped: 2, noGithubOrigin: true });
  assert.deepEqual(record.versions, {
    node: "24.20.0",
    pnpm: "10.34.5",
    git: "2.55.0",
  });
  // Everything a step printed is indented, so none of it can look like a record.
  assert.match(sys.printed, /\n {2}windows-run result x: \{\}\n/);
  assert.ok(
    sys.printed
      .split("\n")
      .filter((line) => line.startsWith("windows-run result ")).length === 1,
  );
  // Clean up: worktree, staging and ref gone; a clean run keeps no log.
  assert.equal(existsSync(path.join(home, ROOT, "runs", RUN_ID)), false);
  assert.equal(existsSync(path.join(home, ROOT, "lock")), false);
  assert.deepEqual(sys.deletedRefs, [`refs/windows-run/${RUN_ID}`]);
  assert.equal(
    existsSync(path.join(home, ROOT, "logs", `${RUN_ID}.log`)),
    false,
  );
});

void test("the worktree is made with git hooks turned off", async (t) => {
  const sys = fakeSys({ home: tempDir(t) });
  await runRemote(RUN_ID, SHA, sys);
  const add = sys.gitCalls.find((call) => call.args.includes("add"));
  assert.ok(add);
  assert.deepEqual(add.args.slice(0, 2), ["-c", "core.hooksPath=NUL"]);
  assert.ok(add.args.includes("--detach"));
  assert.ok(add.args.includes(SHA));
  const config = sys.gitCalls.find((call) => call.args[0] === "config");
  assert.deepEqual(config?.args, ["config", "core.longpaths", "true"]);
});

void test("a failed step stops the rest and is exit 1 with a clean cleanup", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({
    home,
    steps: { check: { exitCode: 1, lines: ["boom"] } },
  });
  const code = await runRemote(RUN_ID, SHA, sys);
  assert.equal(code, 1);
  assert.deepEqual(sys.stepsRun, ["install", "check"]);
  const record = lastRecord(sys.printed);
  assert.deepEqual(
    record.steps.map((step) => step.status),
    ["passed", "failed", "not-run"],
  );
  assert.deepEqual(record.cleanup, []);
  // A run that did not pass keeps its log.
  assert.match(
    readFileSync(path.join(home, ROOT, "logs", `${RUN_ID}.log`), "utf8"),
    /boom/,
  );
});

void test("the local verdict reads the runner's real output and exit code as the runner meant them", async (t) => {
  // ssh hands back the runner's exit code, so the two sides must agree on
  // it: a pass is 0, a failed step 1, a refused run 1.
  const cases = [
    { steps: {}, expected: 0 },
    { steps: { check: { exitCode: 1 } }, expected: 1 },
    { steps: {}, headSha: "f".repeat(40), expected: 1 },
  ];
  for (const { steps, headSha, expected } of cases) {
    const sys = fakeSys({
      home: tempDir(t),
      steps,
      ...(headSha === undefined ? {} : { headSha }),
    });
    const exit = await runRemote(RUN_ID, SHA, sys);
    const lines = sys.printed
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));
    assert.equal(judge(lines, RUN_ID, SHA, exit).code, expected);
  }
});

void test("a step past its deadline is recorded as timed out", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    steps: { install: { timedOut: true } },
  });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  assert.equal(lastRecord(sys.printed).steps[0]?.status, "timed-out");
});

void test("a cleanup failure after passing steps is reported and stays a pass", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({ home });
  const realRm = sys.fs.rm.bind(sys.fs);
  const stuck = path.join(home, ROOT, "runs", RUN_ID);
  sys.fs.rm = (target) =>
    target === stuck ? Promise.reject(new Error("locked")) : realRm(target);
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  const record = lastRecord(sys.printed);
  assert.deepEqual(record.cleanup, ["could not remove the run's worktree"]);
  assert.match(
    sys.printed,
    /cleanup problem: could not remove the run's worktree/,
  );
  // The log is kept when cleanup failed.
  assert.ok(existsSync(path.join(home, ROOT, "logs", `${RUN_ID}.log`)));
});

void test("a commit mismatch on Windows fails the run before any step", async (t) => {
  const sys = fakeSys({ home: tempDir(t), headSha: "f".repeat(40) });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  assert.deepEqual(sys.stepsRun, []);
  const record = lastRecord(sys.printed);
  assert.equal(record.refusal, "commit-mismatch");
  assert.ok(record.steps.every((step) => step.status === "not-run"));
});

function lockWith(home: string, owner: object | undefined): string {
  const lock = path.join(home, ROOT, "lock");
  mkdirSync(lock, { recursive: true });
  if (owner !== undefined) {
    writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner));
  }
  return lock;
}

void test("a live holder refuses the run and keeps its lock", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({ home });
  sys.procs.push({ pid: 555, name: "node", startMs: RUNNER_START - 60_000 });
  const lock = lockWith(home, {
    pid: 555,
    startMs: RUNNER_START - 60_000,
    runId: "deadbeef",
  });
  // The holder is a leftover by the sweep's rules, but the lock check
  // comes first and the run is refused before anything is stopped.
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  assert.equal(lastRecord(sys.printed).refusal, "lock-held");
  assert.match(sys.printed, /another run is in progress/);
  assert.match(sys.printed, /delete .*lock/);
  assert.ok(existsSync(path.join(lock, "owner.json")));
  assert.deepEqual(sys.killed, []);
  assert.deepEqual(sys.stepsRun, []);
});

void test("a dead holder, or a lock with no owner file, is taken over and reported", async (t) => {
  for (const owner of [
    { pid: 999, startMs: 5, runId: "deadbeef" },
    undefined,
  ]) {
    const home = tempDir(t);
    lockWith(home, owner);
    const sys = fakeSys({ home });
    assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
    assert.match(sys.printed, /took over/);
    assert.equal(existsSync(path.join(home, ROOT, "lock")), false);
    assert.equal(
      readdirSync(path.join(home, ROOT)).some((name) =>
        name.startsWith("lock"),
      ),
      false,
    );
  }
});

void test("the sweep finds and reports a killed run's folders, refs and processes", async (t) => {
  const home = tempDir(t);
  const root = path.join(home, ROOT);
  for (const dir of [
    "runs/oldrun1",
    "incoming/oldrun1",
    "lock.oldrun1",
    "clone/.git",
  ]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  const sys = fakeSys({
    home,
    refs: ["refs/windows-run/oldrun1", `refs/windows-run/${RUN_ID}`],
  });
  sys.procs.push(
    // Started seconds before this session: a leftover, whatever it is.
    { pid: 301, name: "node", startMs: RUNNER_START - 5_000 },
    // Long before the session's shell: not one of its helpers.
    { pid: 302, name: "sshd-session", startMs: RUNNER_START - 600_000 },
    // Not the account's own: unreadable start time, never touched.
    { pid: 303, name: "other", startMs: null },
  );
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.deepEqual(sys.killed.sort(), [301, 302]);
  for (const spared of [90, 80, 70, 100, 303]) {
    assert.equal(
      sys.killed.includes(spared),
      false,
      `spared ${String(spared)}`,
    );
  }
  assert.match(sys.printed, /leftover run folder oldrun1/);
  assert.match(sys.printed, /leftover staging folder oldrun1/);
  assert.match(sys.printed, /stale lock folder lock.oldrun1/);
  assert.match(sys.printed, /leftover ref refs\/windows-run\/oldrun1/);
  assert.ok(sys.deletedRefs.includes("refs/windows-run/oldrun1"));
  assert.equal(existsSync(path.join(root, "runs", "oldrun1")), false);
});

void test("a process the sweep cannot stop fails the run before anything shared is touched", async (t) => {
  const home = tempDir(t);
  const root = path.join(home, ROOT);
  mkdirSync(path.join(root, "runs", "oldrun1"), { recursive: true });
  const sys = fakeSys({ home });
  sys.procs.push({ pid: 301, name: "node", startMs: RUNNER_START - 5_000 });
  sys.unkillable.add(301);
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  const record = lastRecord(sys.printed);
  assert.equal(record.refusal, "sweep-failed");
  assert.match(record.cleanup.join(" "), /node \(pid 301\)/);
  assert.deepEqual(sys.stepsRun, []);
  assert.ok(existsSync(path.join(root, "runs", "oldrun1")));
  assert.equal(existsSync(path.join(root, "lock")), false);
});

void test("what a step leaves running is stopped before the next step", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    steps: {
      install: {
        leaves: [{ pid: 401, name: "node", startMs: RUNNER_START + 6_000 }],
      },
    },
  });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.ok(sys.killed.includes(401));
  // The after-step pass stopped it, so check never saw it running.
  assert.equal(sys.seenAtStep.check?.includes(401), false);
});

void test("a step's leftover that will not stop fails the run there", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    steps: {
      install: {
        leaves: [{ pid: 401, name: "node", startMs: RUNNER_START + 6_000 }],
      },
    },
  });
  sys.unkillable.add(401);
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  const record = lastRecord(sys.printed);
  assert.deepEqual(
    record.steps.map((step) => step.status),
    ["failed", "not-run", "not-run"],
  );
  assert.match(
    record.cleanup.join(" "),
    /node \(pid 401\) left by install would not stop/,
  );
});

void test("a pid whose start time changed is never stopped", async (t) => {
  const sys = fakeSys({ home: tempDir(t) });
  sys.procs.push({ pid: 301, name: "node", startMs: RUNNER_START - 5_000 });
  // The pid is reused between the listing and the kill.
  sys.startOf = (pid) => Promise.resolve(pid === 301 ? 42 : null);
  sys.unkillable.add(301);
  await runRemote(RUN_ID, SHA, sys);
  assert.equal(sys.killed.includes(301), false);
});

void test("cleanup stops only processes started after the runner", async (t) => {
  const sys = fakeSys({
    home: tempDir(t),
    steps: {
      build: {
        leaves: [{ pid: 501, name: "node", startMs: RUNNER_START + 7_000 }],
      },
    },
  });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.ok(sys.killed.includes(501));
  for (const spared of [90, 80, 70, 100]) {
    assert.equal(sys.killed.includes(spared), false);
  }
});

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
