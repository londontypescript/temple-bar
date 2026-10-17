// The entry point must run whatever path it is started by. Started through
// a link, a check for "was I started directly?" sees the link's path in
// argv and the real file's in import.meta.url, and a run that skipped every
// test would pass.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./run-tests.ts", import.meta.url));

void test("the entry point runs Node with its arguments even when started through a link", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tb-entry-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const link = path.join(dir, "run-tests.ts");
  symlinkSync(ENTRY, link, "file");
  const ran = spawnSync(
    process.execPath,
    [link, "-e", "process.exit(7)"],
    // Without this, a child Node thinks it is one of this runner's files.
    { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } },
  );
  assert.equal(
    ran.status,
    7,
    `the run's own exit code comes back: ${ran.stderr}`,
  );
});
