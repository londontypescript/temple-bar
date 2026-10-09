import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRunner, Interrupted } from "./runner.ts";

for (const stop of ["deadline", "interrupt"] as const) {
  void test(`Windows ${stop} waits for tree-stop command after parent close`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "runner-completion-"));
    const release = path.join(directory, "release-killer");
    const controller = new AbortController();
    let primary: ChildProcess | undefined;
    let killer: ChildProcess | undefined;
    // Real child processes exercise close ordering on every OS. The fake
    // taskkill kills the parent but awaits an explicit release before exit.
    const launch = (
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ): ChildProcess => {
      if (command === "node.exe") {
        primary = spawn(process.execPath, args, options);
        return primary;
      }
      assert.equal(command, "taskkill");
      assert.deepEqual(args.slice(2), ["/T", "/F"]);
      const script =
        'process.kill(Number(process.argv[1]), "SIGKILL"); const timer = setInterval(() => {if (require("node:fs").existsSync(process.argv[2])) {clearInterval(timer);}}, 10);';
      killer = spawn(
        process.execPath,
        ["-e", script, args[1] ?? "", release],
        options,
      );
      return killer;
    };
    const runner = createRunner("win32", launch as typeof spawn);
    const pending = runner({
      command: "node.exe",
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: directory,
      env: process.env,
      deadline: stop === "deadline" ? 200 : 5000,
      signal: controller.signal,
    });
    // Attach both handlers before an interrupt can reject the promise.
    let settled = false;
    const observed = pending.then(
      (result) => {
        settled = true;
        return { result };
      },
      (error: unknown) => {
        settled = true;
        return { error };
      },
    );
    assert.ok(primary);
    const closed = once(primary, "close");
    try {
      if (stop === "interrupt") controller.abort();
      await closed;
      await Promise.resolve();
      assert.ok(killer, "the tree-stop command ran");
      assert.equal(
        killer.exitCode,
        null,
        "tree-stop command is still held open",
      );
      assert.equal(
        settled,
        false,
        "runner returned before tree-stop command completed",
      );
      writeFileSync(release, "finish");
      const outcome = await observed;
      assert.equal(killer.exitCode, 0);
      if (stop === "interrupt") {
        assert.ok("error" in outcome && outcome.error instanceof Interrupted);
      } else {
        assert.ok("result" in outcome);
        assert.equal(outcome.result.timedOut, true);
        assert.notEqual(outcome.result.code, 0);
      }
    } finally {
      if (!existsSync(release)) writeFileSync(release, "finish");
      controller.abort();
      await observed;
      if (killer !== undefined && killer.exitCode === null)
        await once(killer, "close");
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
