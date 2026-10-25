// On Windows, checks Git's shared /tmp from inside the run, as a hook's shell
// sees it. These can only show the run's /tmp holding; that it would move
// without the shell the runner's global setup (anchor.ts) starts is shown
// outside any run, since this run's own shell is part of what is being
// tested.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { SHARED_TMP_VARIABLE, withTemp } from "./lifecycle.ts";
import { realDeps } from "./real.ts";

const skip = process.platform !== "win32";
/** How long a shell gets to start, or to leave once its input closes. */
const WAIT_MS = 30_000;

/** The promise's value, or null if it takes longer than WAIT_MS. */
async function within<T>(promise: Promise<T>): Promise<T | null> {
  const giveUp = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(WAIT_MS, null, { signal: giveUp.signal }),
    ]);
  } finally {
    giveUp.abort();
  }
}
const WARNING = /could not find \/tmp/;

void test(
  "the run's shared /tmp exists and is the folder checked before the first test",
  { skip },
  () => {
    const checked = process.env[SHARED_TMP_VARIABLE];
    assert.ok(
      checked !== undefined && checked !== "",
      `${SHARED_TMP_VARIABLE} is not set: run the suite with pnpm test, whose runner sets it in its global setup, scripts/run-tests/anchor.ts`,
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
    // The same process handling the run's own shell uses: whole lines, and
    // an end that also reports a shell that could not start.
    const keeper = realDeps().start("sh", ["-c", "echo up; read _"], {
      env: withTemp(process.env, dir),
    });
    t.after(async () => {
      keeper.closeStdin();
      const ended = await within(keeper.ended);
      if (ended === null) {
        keeper.kill();
      }
      rmSync(dir, { recursive: true, force: true });
      assert.ok(
        ended !== null,
        `the first shell did not exit within ${String(WAIT_MS / 1000)}s of its input closing`,
      );
    });
    const up = new Promise<"up">((resolve) => {
      keeper.onLine((line) => {
        if (line === "up") {
          resolve("up");
        }
      });
    });
    const first = await within(Promise.race([up, keeper.ended]));
    assert.equal(
      first,
      "up",
      first === null
        ? `the first shell did not say it was up within ${String(WAIT_MS / 1000)}s`
        : `the first shell ended before it was up: ${JSON.stringify(first)} ${keeper.stderr()}`,
    );
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
