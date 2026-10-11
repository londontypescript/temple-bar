// The entry file refuses a Node below the minimum before loading anything
// else. A real old Node isn't installed here; the run is given a faked
// version instead, which is all the entry file looks at.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FAKE_VERSION =
  "data:text/javascript," +
  encodeURIComponent(
    "Object.defineProperty(process.versions, 'node', { value: '22.1.0' });",
  );

void test("cli.ts: below the minimum Node it exits 1, says what it found and what to do, and runs nothing", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      FAKE_VERSION,
      fileURLToPath(new URL("./cli.ts", import.meta.url)),
      "--help",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /needs Node 24 or newer, but this is Node 22\.1\.0/,
  );
  assert.ok(result.stderr.includes(process.execPath));
  assert.match(result.stderr, /Nothing was changed/);
});
