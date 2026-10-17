// On Windows, checks Git's shared /tmp from inside the run, as a hook's shell
// sees it. These can only show the run's /tmp holding; that it would move
// without the shell scripts/run-tests.ts starts is shown outside any run,
// since this run's own shell is part of what is being tested.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SHARED_TMP_VARIABLE, withTemp } from "./lifecycle.ts";

const skip = process.platform !== "win32";
const WARNING = /could not find \/tmp/;

void test(
  "the run's shared /tmp exists and is the folder checked before the first test",
  { skip },
  () => {
    const checked = process.env[SHARED_TMP_VARIABLE];
    assert.ok(
      checked !== undefined && checked !== "",
      `${SHARED_TMP_VARIABLE} is not set: run the suite with pnpm test, which starts it through scripts/run-tests.ts`,
    );
    const asked = spawnSync("sh", ["-c", "/usr/bin/cygpath -w /tmp"], {
      encoding: "utf8",
    });
    assert.equal(asked.status, 0, asked.stderr);
    assert.doesNotMatch(asked.stderr, WARNING);
    const now = asked.stdout.trim();
    assert.ok(existsSync(now), `the shared /tmp, ${now}, does not exist`);
    assert.equal(
      realpathSync.native(now).toLowerCase(),
      checked.toLowerCase(),
      `the shared /tmp moved from ${checked} to ${now}`,
    );
  },
);

// What the suite does all the time: a shell starts with a test's own temp
// folder, which is deleted while that shell is still alive. A shell started
// after that must still find /tmp.
void test(
  "deleting a live shell's temp folder leaves later shells a /tmp",
  { skip },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "first-owner-"));
    const keeper = spawn("sh", ["-c", "echo up; read _"], {
      env: withTemp(process.env, dir),
      stdio: "pipe",
      windowsHide: true,
    });
    const gone = new Promise((resolve) => {
      keeper.on("exit", resolve);
      keeper.on("error", resolve);
    });
    t.after(async () => {
      keeper.stdin.end();
      await gone;
      rmSync(dir, { recursive: true, force: true });
    });
    keeper.stdout.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      keeper.stdout.on("data", (text: string) => {
        if (text.includes("up")) {
          resolve();
        }
      });
      keeper.on("error", reject);
    });
    rmSync(dir, { recursive: true, force: true });

    const later = spawnSync("sh", ["-c", "true"], { encoding: "utf8" });
    assert.equal(later.status, 0);
    assert.doesNotMatch(
      later.stderr,
      WARNING,
      `a shell started after another's temp folder was deleted lost /tmp: ${later.stderr}`,
    );
  },
);
