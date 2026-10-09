import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { runProcess, Interrupted } from "./runner.ts";

void test("runner closes stdin, keeps the last 64 KiB across both streams and reports spawn errors", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scaffold-runner-test-"));
  try {
    const result = await runProcess({
      command: process.execPath,
      args: [
        "-e",
        'process.stdin.resume(); process.stdin.on("end", () => {process.stdout.write("a".repeat(40000)+"|stdout|"); process.stderr.write("b".repeat(40000)+"|stderr|");});',
      ],
      cwd: dir,
      env: process.env,
      deadline: 5000,
    });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.timedOut, false);
    assert.equal(
      Buffer.byteLength(result.output),
      64 * 1024,
      "per-command output is bounded to the final 64 KiB",
    );
    assert.ok(
      result.output.includes("|stdout|") && result.output.includes("|stderr|"),
      "both output streams contribute to the tail",
    );
    assert.equal(
      result.stdout,
      `${"a".repeat(40000)}|stdout|`,
      "standard output is kept on its own, without the other stream",
    );
    const missing = await runProcess({
      command: path.join(dir, "no-command"),
      args: [],
      cwd: dir,
      env: process.env,
      deadline: 5000,
    });
    assert.notEqual(missing.code, 0, "spawn failure returns a failing result");
    assert.ok(missing.output.length > 0, "spawn error is retained in output");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const stop of ["deadline", "Ctrl-C"] as const) {
  void test(`runner kills the whole child group on ${stop}`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scaffold-runner-group-"));
    const marker = path.join(dir, "grandchild-heartbeat");
    const controller = new AbortController();
    // Fixed scripts, with the marker path passed as an argument: no code is
    // built from a value.
    const grandchild =
      'const fs = require("node:fs"); const beat = () => fs.appendFileSync(process.argv[1], "tick"); beat(); setInterval(beat, 50); setTimeout(() => process.exit(0), 10000);';
    const parent =
      'const [marker, grandchild] = process.argv.slice(1); require("node:child_process").spawn(process.execPath, ["-e", grandchild, marker], {stdio: "ignore"}); setInterval(() => {}, 1000);';
    try {
      const pending = runProcess({
        command: process.execPath,
        args: ["-e", parent, marker, grandchild],
        cwd: dir,
        env: process.env,
        deadline: 5000,
        signal: controller.signal,
      });
      // Observe rejection immediately, and await cleanup even when an earlier
      // assertion fails, so interruption cannot hide the original failure.
      const stopped = pending.catch(() => undefined);
      try {
        if (stop === "Ctrl-C") {
          for (let attempt = 0; !existsSync(marker) && attempt < 200; attempt++)
            await setTimeout(20);
          assert.ok(
            existsSync(marker),
            "grandchild started before interruption",
          );
          controller.abort();
          await assert.rejects(
            pending,
            Interrupted,
            "interrupt stops the runner",
          );
        } else {
          const result = await pending;
          assert.equal(result.timedOut, true, "deadline is recorded");
          assert.notEqual(result.code, 0);
        }
        assert.ok(
          existsSync(marker),
          "grandchild ran before the group stopped",
        );
        // A loaded host can deliver the stopping timer late. Writes before
        // termination say nothing about cleanup; further writes do.
        const stoppedSize = statSync(marker).size;
        assert.ok(stoppedSize > 0, "the grandchild heartbeat was exercised");
        await setTimeout(1000);
        assert.equal(
          statSync(marker).size,
          stoppedSize,
          "grandchild kept writing after the process group stopped",
        );
      } finally {
        controller.abort();
        await stopped;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
