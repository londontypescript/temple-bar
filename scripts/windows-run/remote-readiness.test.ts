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
import { runRemote } from "./remote/runner.ts";

async function refusedRun(
  t: TestContext,
  options: Omit<FakeSysOptions, "home">,
  breakLinks = false,
): Promise<ReturnType<typeof fakeSys>> {
  const sys = fakeSys({ home: tempDir(t), ...options });
  if (breakLinks) {
    sys.fs.symlink = () =>
      Promise.reject(
        Object.assign(new Error("operation not permitted"), {
          code: "EPERM",
        }),
      );
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

  const other = await refusedRun(t, { shAt: "C:\\msys64\\usr\\bin\\sh.exe" });
  assert.match(other.printed, /sh on PATH is C:\\msys64.*not Git's/);

  const shouting = fakeSys({
    home: tempDir(t),
    shAt: "C:\\PROGRAM FILES\\GIT\\USR\\BIN\\SH.EXE",
  });
  assert.equal(await runRemote(RUN_ID, SHA, shouting), 0);
});

void test("an account that can't make links is refused", async (t) => {
  const sys = await refusedRun(t, {}, true);
  assert.match(sys.printed, /can't make symbolic links \(EPERM\)/);
});

void test("taskkill /T must stop all three levels", async (t) => {
  const refused = await refusedRun(t, { tree: { stopCode: 1 } });
  assert.match(refused.printed, /taskkill \/T exited 1/);

  const partial = await refusedRun(t, { tree: { childrenSurvive: true } });
  assert.match(partial.printed, /taskkill \/T left 2 of 3 levels running/);
  // The run's own cleanup stops what the check left.
  assert.deepEqual(partial.killed.sort(), [501, 502]);
  assert.ok(partial.procs.every((proc) => proc.pid < 500));

  const short = await refusedRun(t, { tree: { starts: 2 } });
  assert.match(short.printed, /3-level process tree would not start \(got 2\)/);
});

void test("every problem is reported, not just the first", async (t) => {
  const sys = await refusedRun(
    t,
    { shAt: null, tree: { stopCode: 128 } },
    true,
  );
  const reasons = sys.printed.match(/machine not ready: /g) ?? [];
  assert.equal(reasons.length, 3);
});
