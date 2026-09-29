import assert from "node:assert/strict";
import test from "node:test";

import {
  createProcSeam,
  isAllowedShellCommand,
  isSafeForShell,
  isSafeShellArg,
} from "./proc.ts";
import { createFakeWriter } from "../testing/fakes.ts";

void test("proc seam: streams stdout/stderr live and resolves the exit code", async () => {
  const proc = createProcSeam();
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();

  const code = await proc.run(
    process.execPath,
    [
      "-e",
      'process.stdout.write("out-chunk\\n"); process.stderr.write("err-chunk\\n"); process.exit(3);',
    ],
    { cwd: process.cwd(), env: process.env, stdout, stderr },
  );

  assert.equal(code, 3);
  assert.equal(stdout.lines.join(""), "out-chunk\n");
  assert.equal(stderr.lines.join(""), "err-chunk\n");
});

void test("proc seam: a zero exit is reported as 0", async () => {
  const proc = createProcSeam();
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();

  const code = await proc.run(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(),
    env: process.env,
    stdout,
    stderr,
  });

  assert.equal(code, 0);
});

void test("proc seam: a missing executable never throws and resolves a non-zero code", async () => {
  const proc = createProcSeam();
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();

  const code = await proc.run(
    "temple-bar-definitely-not-a-real-executable",
    [],
    { cwd: process.cwd(), env: process.env, stdout, stderr },
  );

  assert.notEqual(code, 0);
});

void test("isAllowedShellCommand only allows npm and pnpm", () => {
  assert.equal(isAllowedShellCommand("npm"), true);
  assert.equal(isAllowedShellCommand("pnpm"), true);
  assert.equal(isAllowedShellCommand("rm"), false);
  assert.equal(isAllowedShellCommand("npm.exe"), false);
});

void test("isSafeShellArg only allows the narrow charset the gate needs", () => {
  assert.equal(isSafeShellArg("run"), true);
  assert.equal(isSafeShellArg("typecheck"), true);
  assert.equal(isSafeShellArg("format:check"), true);
  assert.equal(isSafeShellArg("pre:build"), true);
  assert.equal(isSafeShellArg("; rm -rf /"), false);
  assert.equal(isSafeShellArg("$(echo hi)"), false);
  assert.equal(isSafeShellArg("a b"), false);
  assert.equal(isSafeShellArg(""), false);
});

void test("isSafeForShell requires both an allowed command and safe args", () => {
  assert.equal(isSafeForShell("npm", ["run", "typecheck"]), true);
  assert.equal(isSafeForShell("npm", ["run", "typecheck; rm -rf /"]), false);
  assert.equal(isSafeForShell("bash", ["-c", "echo hi"]), false);
});
