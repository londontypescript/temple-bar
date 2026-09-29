// Unit tests for createHookCommand's routing, using the fakes (../testing/
// fakes.ts) rather than real git, mirroring router.test.ts's style for the
// F12/P8.2 "writes nothing" contract.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeGit,
  createFakeWriter,
} from "../testing/fakes.ts";
import { createHookCommand } from "./command.ts";

function neverCalledStdin(): Promise<string> {
  return Promise.reject(new Error("readStdin should not have been called"));
}

void test("hook: an unknown subcommand prints usage to stderr, exits 2, and touches nothing", async () => {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const git = createFakeGit();
  const ctx = createFakeContext({ stdout, stderr, git });
  const command = createHookCommand(neverCalledStdin);

  const code = await command.run(["bogus"], ctx);

  assert.equal(code, 2);
  assert.equal(stdout.lines.length, 0);
  assert.match(stderr.lines.join(""), /^Usage: temple-bar hook/);
  assert.equal(git.calls.length, 0);
});

void test("hook: no subcommand prints usage to stderr and exits 2", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ stderr });
  const command = createHookCommand(neverCalledStdin);

  const code = await command.run([], ctx);

  assert.equal(code, 2);
  assert.match(stderr.lines.join(""), /^Usage: temple-bar hook/);
});

void test("hook: reference-transaction with no state prints usage and exits 2 without reading stdin", async () => {
  const stderr = createFakeWriter();
  const ctx = createFakeContext({ stderr });
  const command = createHookCommand(neverCalledStdin);

  const code = await command.run(["reference-transaction"], ctx);

  assert.equal(code, 2);
  assert.match(stderr.lines.join(""), /^Usage: temple-bar hook/);
});

void test("hook: pre-commit never calls readStdin", async () => {
  const ctx = createFakeContext();
  const command = createHookCommand(neverCalledStdin);

  const code = await command.run(["pre-commit"], ctx);

  // createFakeGit's default script returns branch info that isn't "main",
  // so this just proves readStdin() wasn't touched (it would have thrown).
  assert.equal(typeof code, "number");
});

void test("hook: install reports each item and exits 1 when a conflict is reported", async () => {
  const stdout = createFakeWriter();
  const git = createFakeGit((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    // Every config read/write "fails" so installConfig reports conflicts.
    return { code: 1, stdout: "", stderr: "boom" };
  });
  const fs = createFakeFs();
  const ctx = createFakeContext({ stdout, git, fs });
  const command = createHookCommand(neverCalledStdin);

  const code = await command.run(["install"], ctx);

  assert.equal(code, 1);
  const output = stdout.lines.join("");
  assert.match(output, /written: \.githooks\/pre-commit/);
  assert.match(output, /conflict: core\.hooksPath/);
});
