import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  fakeSys,
  type FakeSysOptions,
  lastRecord,
  RUN_ID,
  SHA,
  tempDir,
} from "./testing.ts";
import { stopTreeFrom } from "./remote/real.ts";
import { runRemote } from "./remote/runner.ts";

/** Links whose target is `refused` fail as a standard account's would. */
async function refusedRun(
  t: TestContext,
  options: Omit<FakeSysOptions, "home">,
  refused?: string,
): Promise<ReturnType<typeof fakeSys>> {
  const sys = fakeSys({ home: tempDir(t), ...options });
  if (refused !== undefined) {
    // A copy: the fake's fs is the shared real one, which other runs use.
    const symlink = sys.fs.symlink.bind(sys.fs);
    Object.assign(sys, {
      fs: {
        ...sys.fs,
        symlink: (target: string, at: string, type: "file" | "dir") =>
          target === refused
            ? Promise.reject(
                Object.assign(new Error("operation not permitted"), {
                  code: "EPERM",
                }),
              )
            : symlink(target, at, type),
      },
    });
  }
  assert.equal(await runRemote(RUN_ID, SHA, sys), 1);
  const record = lastRecord(sys.printed);
  assert.equal(record.refusal, "machine-not-ready");
  assert.deepEqual(sys.stepsRun, []);
  assert.ok(record.steps.every((step) => step.status === "not-run"));
  // Refused before the commit was even fetched.
  assert.ok(!sys.gitCalls.some((call) => call.args.includes("fetch")));
  return sys;
}

void test("a ready machine runs every step, and the check leaves nothing behind", async (t) => {
  const home = tempDir(t);
  const sys = fakeSys({ home });
  assert.equal(await runRemote(RUN_ID, SHA, sys), 0);
  assert.deepEqual(sys.stepsRun, ["install", "check", "build"]);
  assert.equal(sys.treePids.length, 3);
  assert.ok(sys.procs.every((proc) => !sys.treePids.includes(proc.pid)));
  assert.ok(
    !existsSync(path.join(home, "temple-bar-windows-run", "incoming", RUN_ID)),
  );
});

void test("sh must be Git's own, found case-insensitively", async (t) => {
  const missing = await refusedRun(t, { shAt: null });
  assert.match(missing.printed, /no sh on PATH: add .*Git\\usr\\bin/);

  const msys = await refusedRun(t, { shAt: "C:\\msys64\\usr\\bin\\sh.exe" });
  assert.match(msys.printed, /sh on PATH is C:\\msys64.*not Git's/);

  const silent = await refusedRun(t, { shSays: null });
  assert.match(silent.printed, /is on PATH but would not run a command/);
  const other = await refusedRun(t, { shSays: "something else\n" });
  assert.match(other.printed, /is on PATH but would not run a command/);

  const com = await refusedRun(t, { shComAt: "C:\\tools\\sh.com" });
  assert.match(com.printed, /C:\\tools\\sh\.com is on PATH/);

  const shouting = fakeSys({
    home: tempDir(t),
    shAt: "C:\\PROGRAM FILES\\GIT\\USR\\BIN\\SH.EXE",
  });
  assert.equal(await runRemote(RUN_ID, SHA, shouting), 0);
});

void test("each kind of link must be possible: to a file, a folder and nothing", async (t) => {
  for (const target of ["file", "folder", "missing"]) {
    const sys = await refusedRun(t, {}, target);
    assert.match(
      sys.printed,
      /can't make symbolic links \(EPERM\)/,
      `refusing links to ${target}`,
    );
  }
  // Each refusal was its own run's: a run after them all, on the same shared
  // fs, can make every link.
  assert.equal(await runRemote(RUN_ID, SHA, fakeSys({ home: tempDir(t) })), 0);
});

void test("taskkill runs only while the tree's own top is still running", () => {
  const calls: (readonly string[])[] = [];
  const run = (args: readonly string[]): number => {
    calls.push(args);
    return 0;
  };
  const running = { pid: 42, exitCode: null, signalCode: null };
  assert.equal(stopTreeFrom(running, 42, run), 0);
  assert.deepEqual(calls, [["/T", "/F", "/PID", "42"]]);

  calls.length = 0;
  for (const top of [
    { pid: 42, exitCode: 0, signalCode: null },
    { pid: 42, exitCode: null, signalCode: "SIGTERM" as const },
    { pid: 43, exitCode: null, signalCode: null },
    undefined,
  ]) {
    assert.equal(stopTreeFrom(top, 42, run), null);
  }
  assert.deepEqual(calls, []);
});

void test("taskkill /T must stop all three levels", async (t) => {
  const refused = await refusedRun(t, { tree: { stopCode: 1 } });
  assert.match(refused.printed, /taskkill \/T exited 1/);

  const partial = await refusedRun(t, { tree: { childrenSurvive: true } });
  assert.match(partial.printed, /taskkill \/T left 2 of 3 levels running/);
  // The run's own cleanup stops what the check left.
  assert.deepEqual(partial.killed.sort(), [501, 502]);
  assert.ok(partial.procs.every((proc) => proc.pid < 500));

  const unconfirmed = await refusedRun(t, {
    tree: { childrenSurvive: true, unreadable: true },
  });
  assert.match(unconfirmed.printed, /taskkill \/T left 2 of 3 levels running/);

  // The top exited first: its pid may be reused, so nothing was stopped.
  const gone = await refusedRun(t, { tree: { stopCode: null } });
  assert.match(gone.printed, /top process exited before taskkill/);

  const short = await refusedRun(t, { tree: { starts: 2 } });
  assert.match(short.printed, /3-level process tree would not start \(got 2\)/);
});

void test("every problem is reported, not just the first", async (t) => {
  const sys = await refusedRun(
    t,
    { shAt: null, tree: { stopCode: 128 } },
    "file",
  );
  const reasons = sys.printed.match(/machine not ready: /g) ?? [];
  assert.equal(reasons.length, 3);
});
