import assert from "node:assert/strict";
import test from "node:test";

import { runCommand } from "./exec.ts";

void test("runCommand: `input` reaches the child's stdin, which is then closed", async () => {
  const outcome = await runCommand(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { cwd: process.cwd(), env: process.env, input: '{"a":1}' },
  );

  assert.equal(outcome.code, 0);
  assert.equal(outcome.stdout, '{"a":1}');
});
