import assert from "node:assert/strict";
import test from "node:test";

import { createProcessRunner } from "./runner.ts";

void test("createProcessRunner refuses a command outside the fixed allowlist", () => {
  const run = createProcessRunner();
  assert.throws(() => {
    void run("rm", ["-rf", "/"], { cwd: process.cwd(), env: process.env });
  }, /refusing to run/);
});

void test("createProcessRunner refuses an argument a shell would interpret", () => {
  const run = createProcessRunner();
  assert.throws(() => {
    void run("npm", ["install", "x & calc"], {
      cwd: process.cwd(),
      env: process.env,
    });
  }, /unsafe argument/);
});

void test("createProcessRunner runs an allowed command for real and reports its exit code", async () => {
  const run = createProcessRunner();
  const result = await run("npm", ["--version"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.equal(result.code, 0);
});

void test("createProcessRunner reports a non-zero exit code without throwing", async () => {
  const run = createProcessRunner();
  const result = await run("npm", ["this-is-not-a-real-npm-command"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.notEqual(result.code, 0);
});
