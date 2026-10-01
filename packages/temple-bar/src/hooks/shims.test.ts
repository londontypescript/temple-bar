import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  COMMIT_MSG_SHIM,
  PRE_COMMIT_SHIM,
  REFERENCE_TRANSACTION_SHIM,
} from "./shims.ts";

// Also catches a message with a single quote in it, which would end the
// `echo '...'` that prints it early.
void test("shims: all parse as POSIX sh", () => {
  for (const shim of [
    COMMIT_MSG_SHIM,
    PRE_COMMIT_SHIM,
    REFERENCE_TRANSACTION_SHIM,
  ]) {
    const result = spawnSync("sh", ["-n"], { input: shim, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});
