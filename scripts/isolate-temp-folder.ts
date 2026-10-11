// Gives every test file its own temp folder and fails the file if the test
// leaves anything in it, so a test that forgets to clean up is caught the run
// it is written rather than piling up in the system temp folder.
//
// Loaded with `node --import ./scripts/isolate-temp-folder.ts --test`. `node
// --test` runs each test file in its own process and runs this file in each
// of them (never in the outer runner). The folder is made here, and TMPDIR,
// TMP and TEMP point at it, so `os.tmpdir()` in the test and in every process
// it spawns (git, pnpm, hooks, the packed CLI) makes its folders inside it.
// A run killed outright (SIGKILL, a crash) skips the exit check and leaves
// its folder behind; that is accepted, with no sweep of old ones.

import { mkdtempSync, readdirSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The pid of the process that made the folder. A nested test run inherits
 * the variables but has another pid, so it makes and checks its own folder. */
const OWNER = "TEMPLE_BAR_TEST_TMP_OWNER";

const testFile = process.argv[1] ?? "A test file";

function fail(message: string): void {
  // Synchronous: on macOS, output to a pipe written during `exit` through
  // `console.error` can be lost, and CI reads this through a pipe.
  writeSync(2, `${message}\n`);
  // Keep a failure the test already set; only turn a pass into a fail.
  if (Number(process.exitCode ?? 0) === 0) {
    process.exitCode = 1;
  }
}

if (process.env[OWNER] !== String(process.pid)) {
  // A short prefix: pnpm names its store entry for a local tarball after the
  // tarball's path, and refuses names over the filesystem limit.
  const dir = mkdtempSync(path.join(tmpdir(), "tb-t-"));
  process.env[OWNER] = String(process.pid);
  process.env.TMPDIR = dir;
  process.env.TMP = dir;
  process.env.TEMP = dir;
  // Caches that tools keep in the temp folder are not leaks, and would fail
  // every check: pnpm turns on Node's compile cache, and the gate's eslint and
  // knip load their config through jiti, which keeps its own.
  process.env.NODE_DISABLE_COMPILE_CACHE = "1";
  process.env.JITI_FS_CACHE = "0";
  process.on("exit", () => {
    try {
      const left = readdirSync(dir);
      if (left.length > 0) {
        fail(
          `${testFile} left ${String(left.length)} entr${left.length === 1 ? "y" : "ies"} in its temp folder ${dir}: ${left.join(", ")}`,
        );
      }
    } catch (error) {
      fail(`Could not list the test's temp folder ${dir}: ${String(error)}`);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      fail(`Could not delete the test's temp folder ${dir}: ${String(error)}`);
    }
  });
}
