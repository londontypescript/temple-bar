// Every wait the runner makes has a limit. A stop that fails, or output that
// never closes, ends in a named failure instead of a hang, and the runner only
// says a process tree was stopped when the stop reported it.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  CleanupFailed,
  createRunner,
  Interrupted,
  type Limits,
} from "./runner.ts";

const QUICK: Limits = { stop: 300, afterStop: 300, closeGrace: 300 };

/** A child process the test drives by hand, so the order of exit, close and
 * timers is exact rather than left to how fast a machine starts Node. */
class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = 0;
  unrefed = 0;
  kill(): boolean {
    this.killed++;
    return true;
  }
  unref(): void {
    this.unrefed++;
  }
  finish(code: number): void {
    this.exitCode = code;
    this.emit("exit", code, null);
  }
}

interface Fakes {
  readonly launch: typeof spawn;
  readonly primary: FakeChild;
  readonly killers: FakeChild[];
}

/** Fakes the command and every taskkill. `onKill` decides what each taskkill
 * does once it has started. */
function fakes(onKill: (killer: FakeChild, primary: FakeChild) => void): Fakes {
  const primary = new FakeChild();
  const killers: FakeChild[] = [];
  const launch = (command: string): ChildProcess => {
    if (command !== "taskkill") return primary as unknown as ChildProcess;
    const killer = new FakeChild();
    killers.push(killer);
    setImmediate(() => {
      onKill(killer, primary);
    });
    return killer as unknown as ChildProcess;
  };
  return { launch: launch as typeof spawn, primary, killers };
}

const request = (deadline: number, signal?: AbortSignal) => ({
  command: "node.exe",
  args: [],
  cwd: tmpdir(),
  env: process.env,
  deadline,
  ...(signal === undefined ? {} : { signal }),
});

for (const stop of ["deadline", "interrupt"] as const) {
  void test(`a taskkill that never finishes is given up on, on ${stop}, and named`, async () => {
    const world = fakes(() => undefined);
    const controller = new AbortController();
    const pending = createRunner(
      "win32",
      world.launch,
      QUICK,
    )(request(stop === "deadline" ? 20 : 60_000, controller.signal));
    if (stop === "interrupt") controller.abort();
    const error = await pending.then(
      () => assert.fail("a stop that never finished was reported as done"),
      (caught: unknown) => caught,
    );
    assert.ok(
      error instanceof (stop === "deadline" ? CleanupFailed : Interrupted),
    );
    assert.match(String(error), /taskkill did not finish within 0\.3 s/);
    if (stop === "interrupt")
      assert.match(String(error), /could not confirm the command stopped/);
    assert.equal(world.killers.length, 1);
    assert.equal(world.killers[0]?.killed, 1, "the stuck taskkill is stopped");
    assert.equal(
      world.primary.unrefed,
      1,
      "the command is let go, not awaited",
    );
  });
}

void test("a refused taskkill fails at once, without waiting out the limits", async () => {
  const world = fakes((killer) => {
    killer.emit("close", 1, null);
  });
  const limits: Limits = {
    stop: 60_000,
    afterStop: 60_000,
    closeGrace: 60_000,
  };
  const error = await createRunner(
    "win32",
    world.launch,
    limits,
  )(request(20)).then(
    () => assert.fail("a refused stop was reported as done"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof CleanupFailed);
  assert.match(String(error), /taskkill exited 1/);
  assert.doesNotMatch(String(error), /still running/);
});

void test("a successful taskkill on deadline returns a timed-out result", async () => {
  const world = fakes((killer, primary) => {
    primary.finish(1);
    primary.emit("close", 1, null);
    killer.emit("close", 0, null);
  });
  const result = await createRunner("win32", world.launch, QUICK)(request(20));
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});

void test("on Windows, output still open after exit fails, and a later deadline stops nothing by pid", async () => {
  const world = fakes(() => undefined);
  const pending = createRunner("win32", world.launch, QUICK)(request(50));
  world.primary.finish(0);
  await delay(150);
  assert.equal(
    world.killers.length,
    0,
    "a deadline after exit never runs taskkill on a pid that may be reused",
  );
  const error = await pending.then(
    () => assert.fail("held output after exit was reported as a pass"),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof CleanupFailed);
  assert.match(String(error), /output was still open 0\.3 s after it exited/);
  assert.equal(
    world.primary.stdout.destroyed,
    true,
    "the streams are released",
  );
});

void test("on Windows, an interrupt after exit stops nothing by pid", async () => {
  const world = fakes(() => undefined);
  const controller = new AbortController();
  const pending = createRunner(
    "win32",
    world.launch,
    QUICK,
  )(request(60_000, controller.signal));
  world.primary.finish(0);
  controller.abort();
  const error = await pending.then(
    () => assert.fail("an interrupt was reported as a result"),
    (caught: unknown) => caught,
  );
  assert.equal(world.killers.length, 0, "no taskkill on an exited pid");
  assert.ok(error instanceof Interrupted);
  assert.match(String(error), /could not confirm the command stopped/);
});

for (const missing of ["exit", "close"] as const) {
  void test(`after a successful stop, a missing ${missing} is bounded by the after-stop limit`, async () => {
    const world = fakes((killer, primary) => {
      if (missing === "close") primary.finish(1);
      killer.emit("close", 0, null);
    });
    const error = await createRunner(
      "win32",
      world.launch,
      QUICK,
    )(request(20)).then(
      () => assert.fail("a stop that never completed was reported as done"),
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof CleanupFailed);
    assert.match(
      String(error),
      missing === "exit"
        ? /it was still running 0\.3 s after the stop/
        : /its output was still open 0\.3 s after the stop/,
    );
  });
}

void test("output that closes after exit, within the grace, is kept whole", async () => {
  const world = fakes(() => undefined);
  const pending = createRunner("win32", world.launch, QUICK)(request(60_000));
  world.primary.stdout.write("first ");
  world.primary.finish(0);
  await delay(50);
  world.primary.stdout.write("last");
  await delay(10);
  world.primary.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "first last");
});

// Real processes from here: POSIX process groups, and Node's own handles.

const GRANDCHILD =
  'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 20000);';
const PARENT =
  'const [marker, grandchild] = process.argv.slice(1); require("node:child_process").spawn(process.execPath, ["-e", grandchild, marker], {stdio: ["ignore", "inherit", "inherit"]}); const wait = setInterval(() => { if (require("node:fs").existsSync(marker)) { clearInterval(wait); process.exit(0); } }, 20);';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (process.platform !== "win32") {
  void test("on POSIX, a leftover holding output after exit is stopped, and the result isn't trusted", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runner-leftover-"));
    const marker = path.join(dir, "grandchild-pid");
    try {
      // Even an exit code a caller might expect (a refusal's non-zero, say)
      // must not be returned as a result once a leftover was found.
      const error = await createRunner(process.platform, spawn, {
        ...QUICK,
        closeGrace: 1_000,
      })({
        command: process.execPath,
        args: ["-e", PARENT, marker, GRANDCHILD],
        cwd: dir,
        env: process.env,
        deadline: 15_000,
      }).then(
        () => assert.fail("a leftover was returned as a result"),
        (caught: unknown) => caught,
      );
      assert.ok(error instanceof CleanupFailed);
      assert.match(String(error), /left a process holding its output/);
      const grandchild = Number(readFileSync(marker, "utf8"));
      await delay(200);
      assert.equal(alive(grandchild), false, "the leftover was stopped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  void test("on POSIX, an interrupt says what it actually did", async () => {
    const controller = new AbortController();
    const pending = createRunner(process.platform)({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: tmpdir(),
      env: process.env,
      deadline: 15_000,
      signal: controller.signal,
    });
    await delay(100);
    controller.abort();
    await assert.rejects(pending, {
      message: "Interrupted; sent SIGKILL to its process group.",
    });
  });
}

void test("after a failed stop, Node can still exit on its own", async () => {
  // A separate Node process runs the runner with a taskkill that never ends
  // and a command that never ends. It must exit without process.exit().
  const runner = pathToFileURL(path.join(import.meta.dirname, "runner.ts"));
  const script = `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    import { createRunner } from ${JSON.stringify(runner.href)};
    const forever = ["-e", "setInterval(() => {}, 1000)"];
    // The command gives up on its own a while after the runner has: a late
    // exit must not start a timer (the 30-second close grace) that keeps
    // Node alive.
    const late = ["-e", "setTimeout(() => {}, 1500)"];
    const launch = (command, args, options) => {
      if (command === "taskkill")
        return spawn(process.execPath, forever, { stdio: "ignore" });
      return spawn(process.execPath, args, options);
    };
    const limits = { stop: 300, afterStop: 300, closeGrace: 30000 };
    const pending = createRunner("win32", launch, limits)({
      command: "node.exe", args: late, cwd: process.cwd(),
      env: process.env, deadline: 100,
    });
    pending.catch((error) => console.log("settled:", error.message));
    // Stay up past the command's own exit, so that exit is seen.
    setTimeout(() => {}, 2500);
  `;
  const outer = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  outer.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  outer.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const started = Date.now();
  const watchdog = setTimeout(() => outer.kill(), 20_000);
  try {
    const [code] = (await once(outer, "close")) as [number | null];
    assert.equal(
      code,
      0,
      `the outer process never exited by itself:\n${output}`,
    );
    assert.match(output, /settled: .*taskkill did not finish within 0\.3 s/);
    assert.ok(
      Date.now() - started < 15_000,
      "a timer started after the runner settled kept Node alive",
    );
  } finally {
    clearTimeout(watchdog);
    if (outer.exitCode === null) outer.kill();
  }
});
