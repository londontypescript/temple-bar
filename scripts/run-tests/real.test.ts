// The real processes and folders behind the test run, on whichever system
// runs the suite: the anchor on Windows leans on exactly these.

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { realDeps } from "./real.ts";

// Says it is ready, complains on stderr, and exits 0 once its input closes:
// the anchor's part, played by Node so it runs on every system. It gives up
// with code 3 after a while, so a broken pipe fails the test, not hangs it.
const ANCHOR_LIKE = `
process.stdout.write("rea");
setTimeout(() => process.stdout.write("dy\\r\\n"), 20);
process.stderr.write("a warning\\n");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
setTimeout(() => process.exit(3), 5000);`;

void test("a piped process reports whole lines and stderr, and exits once its input closes", async () => {
  const deps = realDeps();
  const proc = deps.start(process.execPath, ["-e", ANCHOR_LIKE], {
    env: process.env,
    piped: true,
  });
  const ready = new Promise<"ready">((resolve) => {
    proc.onLine((line) => {
      if (line === "ready") {
        resolve("ready");
      }
    });
  });
  assert.equal(await Promise.race([ready, proc.ended]), "ready");
  proc.closeStdin();
  assert.deepEqual(await proc.ended, { kind: "exit", code: 0, signal: null });
  assert.equal(proc.stderr(), "a warning\n");
  // Closing it again once it has gone is harmless.
  proc.closeStdin();
});

void test("a process that can't start, or is stopped, says so through its end", async () => {
  const deps = realDeps();
  const missing = deps.start("tb-no-such-command", [], {
    env: process.env,
    piped: true,
  });
  // Bounded, so an error that never reaches `ended` fails rather than hangs.
  const giveUp = new AbortController();
  const ended = await Promise.race([
    missing.ended,
    delay(5_000, null, { signal: giveUp.signal }),
  ]);
  giveUp.abort();
  assert.ok(ended?.kind === "error", "it could not start, and said so");
  assert.match(ended.message, /ENOENT/);

  const waiting = deps.start(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      env: process.env,
      piped: true,
    },
  );
  waiting.kill();
  const stopped = await waiting.ended;
  assert.equal(stopped.kind === "exit" && stopped.signal, "SIGTERM");
});

void test("only an existing folder has a real path", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tb-run-tests-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "file");
  writeFileSync(file, "");
  const deps = realDeps();
  assert.equal(deps.realDir(dir), realpathSync.native(dir));
  assert.equal(deps.realDir(file), null);
  assert.equal(deps.realDir(path.join(dir, "missing")), null);
});
