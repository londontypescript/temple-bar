import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
    void run("pnpm", ["add", "x & calc"], {
      cwd: process.cwd(),
      env: process.env,
    });
  }, /unsafe argument/);
});

void test("createProcessRunner runs an allowed command for real and reports its exit code", async () => {
  const run = createProcessRunner();
  const result = await run("pnpm", ["--version"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.equal(result.code, 0);
});

void test("createProcessRunner reports a non-zero exit code without throwing", async () => {
  const run = createProcessRunner();
  const result = await run("pnpm", ["this-is-not-a-real-pnpm-command"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.notEqual(result.code, 0);
});

void test("createProcessRunner keeps a character whole when it arrives split across two chunks", async () => {
  // "é" is two bytes in UTF-8. The script writes them separately, with a
  // pause between, so the captured output reaches the runner in two pieces.
  const folder = mkdtempSync(path.join(tmpdir(), "temple-bar-runner-"));
  try {
    writeFileSync(
      path.join(folder, "split.js"),
      "process.stdout.write(Buffer.from([0xc3]));\n" +
        "setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 200);\n",
    );
    writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ private: true, scripts: { split: "node split.js" } }),
    );
    const run = createProcessRunner();
    const result = await run("pnpm", ["--silent", "run", "split"], {
      cwd: folder,
      env: process.env,
      capture: true,
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "é");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
