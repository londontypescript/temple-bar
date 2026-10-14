import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { nodeFs, removeWithRetry, type FsLike } from "./remote/fsx.ts";
import { processesFromListing, stopProcesses } from "./remote/processes.ts";
import { capture, runStep } from "./remote/real.ts";
import { fakeSys, RUNNER_START, tempDir } from "./testing.ts";

const STEP = { command: "pnpm", args: ["check"], cwd: process.cwd() };
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
  // One good row doesn't rescue a garbled listing.
  assert.throws(() =>
    processesFromListing({ code: 0, stdout: "1|a|5\ngarbled\n" }, 10),
  );
});

void test("a listing leaves out only its own newer PowerShell and console host, never a leftover's new child", () => {
  assert.deepEqual(
    processesFromListing(
      {
        code: 0,
        stdout:
          "1|a|5\n2|node|50\n3|c|\n4|powershell|50\n5|conhost|60\n6|conhost|5\n",
      },
      10,
    ),
    [
      { pid: 1, name: "a", startMs: 5 },
      { pid: 2, name: "node", startMs: 50 },
      { pid: 3, name: "c", startMs: null },
      { pid: 6, name: "conhost", startMs: 5 },
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

/** A process that does nothing until the test makes it exit, with output
 * streams that stay open, as a leftover grandchild would hold them. */
function heldOpenProcess(): {
  start: typeof spawn;
  exit: (code: number) => void;
} {
  // No pid: when the deadline stops it, nothing real can be signalled.
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return {
    start: (() => child) as unknown as typeof spawn,
    exit: (code) => child.emit("exit", code),
  };
}

void test("the step deadline cannot fire after the process has exited", async (t) => {
  // The clock is fake: nothing fires until the test moves it, so how fast a
  // real process starts can't change the outcome. Exit at 100 ms, then move
  // well past the 250 ms deadline: inside the 600 ms grace, a deadline left
  // armed would call the step timed out.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const proc = heldOpenProcess();
  const outcome = runStep(STEP, 250, () => undefined, 600, proc.start);
  t.mock.timers.tick(100);
  proc.exit(0);
  t.mock.timers.tick(1_000);
  assert.deepEqual(await outcome, { exitCode: 0, timedOut: false });

  // The same process still running at 250 ms is stopped as timed out.
  const late = heldOpenProcess();
  const stopped = runStep(STEP, 250, () => undefined, 600, late.start);
  // Two moves: a fake timer set while the clock moves waits for the next.
  t.mock.timers.tick(300);
  t.mock.timers.tick(1_000);
  assert.deepEqual(await stopped, { exitCode: null, timedOut: true });
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
