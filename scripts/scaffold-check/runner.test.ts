import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
    const marker = path.join(dir, "grandchild-survived");
    const controller = new AbortController();
    // Fixed scripts, with the marker path passed as an argument: no code is
    // built from a value.
    const grandchild =
      'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 800);';
    const parent =
      'const [marker, grandchild] = process.argv.slice(1); require("node:child_process").spawn(process.execPath, ["-e", grandchild, marker], {stdio: "ignore"}); setInterval(() => {}, 1000);';
    try {
      const pending = runProcess({
        command: process.execPath,
        args: ["-e", parent, marker, grandchild],
        cwd: dir,
        env: process.env,
        deadline: stop === "deadline" ? 200 : 5000,
        signal: controller.signal,
      });
      if (stop === "Ctrl-C") {
        await setTimeout(200);
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
      await setTimeout(1000);
      assert.equal(
        existsSync(marker),
        false,
        "grandchild was killed with its parent",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
