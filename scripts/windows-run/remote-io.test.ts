import assert from "node:assert/strict";
import { test } from "node:test";

import { nodeFs, removeWithRetry, type FsLike } from "./remote/fsx.ts";
import { processesFromListing, stopProcesses } from "./remote/processes.ts";
import { capture, runStep } from "./remote/real.ts";
import { fakeSys, RUNNER_START, tempDir } from "./testing.ts";

const noSleep = (): Promise<void> => Promise.resolve();

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

void test("only 'no such file' means gone: other lstat errors are retried then thrown", async (t) => {
  const dir = tempDir(t);
  const stuck: FsLike = {
    ...nodeFs,
    lstat: () => Promise.reject(errno("EPERM")),
  };
  await assert.rejects(removeWithRetry(stuck, noSleep, `${dir}/x`), /EPERM/);
  const missing: FsLike = {
    ...nodeFs,
    lstat: () => Promise.reject(errno("ENOENT")),
  };
  await removeWithRetry(missing, noSleep, `${dir}/x`);
});

void test("a path that cannot be confirmed gone after removal is an error", async (t) => {
  const dir = tempDir(t);
  let calls = 0;
  const flaky: FsLike = {
    ...nodeFs,
    // Present for the first look, then unreadable for the check after.
    lstat: () =>
      ++calls === 1 ? nodeFs.lstat(dir) : Promise.reject(errno("EBUSY")),
    rm: () => Promise.resolve(),
  };
  await assert.rejects(removeWithRetry(flaky, noSleep, `${dir}/x`), /EBUSY/);
});

void test("an empty or failed process listing is an error, never 'no processes'", () => {
  assert.throws(() => processesFromListing({ code: 1, stdout: "1|a|2" }, 10));
  assert.throws(() => processesFromListing({ code: 0, stdout: "" }, 10));
  assert.throws(() => processesFromListing({ code: 0, stdout: "junk" }, 10));
  assert.deepEqual(
    processesFromListing({ code: 0, stdout: "1|a|5\n2|b|50\n3|c|\n" }, 10),
    [
      { pid: 1, name: "a", startMs: 5 },
      { pid: 3, name: "c", startMs: null },
    ],
  );
});

void test("the 15-second stop deadline holds inside a batch of slow queries", async (t) => {
  const sys = fakeSys({ home: tempDir(t) });
  sys.procs.push(
    { pid: 301, name: "node", startMs: RUNNER_START + 10 },
    { pid: 302, name: "node", startMs: RUNNER_START + 20 },
  );
  let queries = 0;
  sys.startOf = (pid) => {
    queries++;
    sys.clock += 20_000;
    return Promise.resolve(
      sys.procs.find((p) => p.pid === pid)?.startMs ?? null,
    );
  };
  const left = await stopProcesses(sys, (proc) => proc.pid >= 300);
  assert.equal(queries, 1);
  assert.deepEqual(sys.killed, []);
  assert.deepEqual(
    left.map((proc) => proc.pid),
    [301, 302],
  );
});

void test("a slow kill cannot push a batch past the deadline", async (t) => {
  const sys = fakeSys({ home: tempDir(t) });
  sys.procs.push(
    { pid: 301, name: "node", startMs: RUNNER_START + 10 },
    { pid: 302, name: "node", startMs: RUNNER_START + 20 },
  );
  let queries = 0;
  const startOf = sys.startOf.bind(sys);
  sys.startOf = (pid) => {
    queries++;
    return startOf(pid);
  };
  const kill = sys.kill.bind(sys);
  sys.kill = (pid) => {
    kill(pid);
    sys.clock += 20_000;
  };
  await stopProcesses(sys, (proc) => proc.pid >= 300);
  assert.equal(queries, 1);
  assert.deepEqual(sys.killed, [301]);
});

// A parent that exits at once while a grandchild keeps the output pipes open
// for a while, as a leftover test server would.
const GRANDCHILD = `
const { spawn } = require("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "inherit" });
setTimeout(() => process.exit(0), 100);
`;

void test("a step ends when its process exits, even if a grandchild holds the streams", async () => {
  const started = Date.now();
  const outcome = await runStep(
    { command: process.execPath, args: ["-e", GRANDCHILD], cwd: process.cwd() },
    5_000,
    () => undefined,
    300,
  );
  assert.deepEqual(outcome, { exitCode: 0, timedOut: false });
  assert.ok(Date.now() - started < 2_000);
});

void test("the step deadline cannot fire after the process has exited", async () => {
  // Deadline 250 ms, exit at 100 ms, grace 600 ms: the old deadline would
  // have fired inside the grace and called the step timed out.
  const outcome = await runStep(
    { command: process.execPath, args: ["-e", GRANDCHILD], cwd: process.cwd() },
    250,
    () => undefined,
    600,
  );
  assert.deepEqual(outcome, { exitCode: 0, timedOut: false });
});

void test("capture resolves after exit despite a grandchild, and stops a process past its timeout", async () => {
  const started = Date.now();
  const done = await capture(process.execPath, ["-e", GRANDCHILD], {
    timeoutMs: 5_000,
    graceMs: 300,
  });
  assert.equal(done.code, 0);
  assert.ok(Date.now() - started < 2_000);
  const slow = await capture(
    process.execPath,
    ["-e", "setTimeout(() => {}, 3000)"],
    {
      timeoutMs: 100,
      graceMs: 100,
    },
  );
  assert.equal(slow.code, 124);
});
