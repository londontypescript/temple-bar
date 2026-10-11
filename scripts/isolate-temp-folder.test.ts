// Runs tiny throwaway scripts under the temp-folder check, in a child Node
// process, since the check works by failing a process as it exits.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

// A file URL, not a path: `--import` reads `D:\...` on Windows as a URL whose
// scheme is `d:`.
const SETUP = new URL("./isolate-temp-folder.ts", import.meta.url).href;

/** Runs `body` as a script (or, with `viaTestRunner`, as a test file) with the
 * check loaded, reading both outputs through pipes the way CI does. */
function runUnderCheck(
  t: TestContext,
  body: string,
  viaTestRunner = false,
): { code: number | null; out: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "check-fixture-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "fixture.test.mjs");
  writeFileSync(file, body);
  const result = spawnSync(
    process.execPath,
    ["--import", SETUP, ...(viaTestRunner ? ["--test"] : []), file],
    // Without this, a child `node --test` thinks it is one of this runner's
    // files and reports to it instead of running on its own.
    { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

void test("a test that leaves a folder behind fails, naming the file's leftover", (t) => {
  const { code, out } = runUnderCheck(
    t,
    `import { mkdtempSync } from "node:fs";
     import { tmpdir } from "node:os";
     import path from "node:path";
     mkdtempSync(path.join(tmpdir(), "leaky-"));`,
  );
  assert.notEqual(code, 0);
  assert.match(out, /fixture\.test\.mjs left 1 entry/);
  assert.match(out, /leaky-/);
});

void test("the test runner marks a leaking test file as failed", (t) => {
  const { code, out } = runUnderCheck(
    t,
    `import { mkdirSync } from "node:fs";
     import path from "node:path";
     import { tmpdir } from "node:os";
     import test from "node:test";
     test("passes", () => { mkdirSync(path.join(tmpdir(), "leaky-run")); });`,
    true,
  );
  assert.notEqual(code, 0);
  assert.match(out, /leaky-run/);
});

void test("a test that cleans up passes and its temp folder is gone", (t) => {
  const { code, out } = runUnderCheck(
    t,
    `import { mkdtempSync, rmSync } from "node:fs";
     import { tmpdir } from "node:os";
     import path from "node:path";
     const made = mkdtempSync(path.join(tmpdir(), "tidy-"));
     rmSync(made, { recursive: true });
     console.log("FOLDER=" + tmpdir());`,
  );
  assert.equal(code, 0, out);
  const folder = /FOLDER=(.*)/.exec(out)?.[1] ?? "";
  assert.ok(folder.length > 0);
  assert.equal(existsSync(folder), false);
});

void test("a failing exit code is kept, and the leftover is still named", (t) => {
  const { code, out } = runUnderCheck(
    t,
    `import { mkdtempSync } from "node:fs";
     import { tmpdir } from "node:os";
     import path from "node:path";
     mkdtempSync(path.join(tmpdir(), "both-"));
     process.exitCode = 3;`,
  );
  assert.equal(code, 3);
  assert.match(out, /both-/);
});

void test("a leak fails even when the exit code would read as a pass", (t) => {
  // The system keeps only the low byte of an exit code, so 256 means success.
  const { code, out } = runUnderCheck(
    t,
    `import { mkdtempSync } from "node:fs";
     import { tmpdir } from "node:os";
     import path from "node:path";
     mkdtempSync(path.join(tmpdir(), "wraps-"));
     process.exitCode = 256;`,
  );
  assert.notEqual(code, 0);
  assert.match(out, /wraps-/);
});

void test("a temp folder that cannot be listed fails with its own message", (t) => {
  const { code, out } = runUnderCheck(
    t,
    `import { rmSync, writeFileSync } from "node:fs";
     import { tmpdir } from "node:os";
     // Swap the folder for a file, so listing it throws.
     rmSync(tmpdir(), { recursive: true });
     writeFileSync(tmpdir(), "");`,
  );
  assert.notEqual(code, 0);
  assert.match(out, /Could not list the test's temp folder/);
});

void test(
  "a temp folder that cannot be deleted fails with its own message",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  (t) => {
    const { code, out } = runUnderCheck(
      t,
      `import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
       import { tmpdir } from "node:os";
       import path from "node:path";
       // A folder nobody may open: listing it works, deleting its contents does not.
       const locked = path.join(tmpdir(), "locked");
       mkdirSync(locked);
       writeFileSync(path.join(locked, "f"), "");
       chmodSync(locked, 0o000);
       console.log("LOCKED=" + locked);`,
    );
    const locked = /LOCKED=(.*)/.exec(out)?.[1];
    if (locked !== undefined) {
      t.after(() => {
        chmodSync(locked, 0o700);
        rmSync(path.dirname(locked), { recursive: true, force: true });
      });
    }
    assert.notEqual(code, 0);
    assert.match(out, /Could not delete the test's temp folder/);
  },
);
