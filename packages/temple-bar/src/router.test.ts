import assert from "node:assert/strict";
import test from "node:test";

import type { Context } from "./context.ts";
import { route } from "./router.ts";
import {
  createFakeFs,
  createFakeGh,
  createFakeGit,
  createFakeWriter,
  createFakeContext,
  type FakeFs,
  type FakeGh,
  type FakeGit,
  type FakeWriter,
} from "./testing/fakes.ts";

interface TestFixture {
  readonly ctx: Context;
  readonly stdout: FakeWriter;
  readonly stderr: FakeWriter;
  readonly fs: FakeFs;
  readonly git: FakeGit;
  readonly gh: FakeGh;
}

function makeFixture(): TestFixture {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const fs = createFakeFs();
  const git = createFakeGit();
  const gh = createFakeGh();
  const ctx = createFakeContext({ stdout, stderr, fs, git, gh });
  return { ctx, stdout, stderr, fs, git, gh };
}

void test("help prints usage to stdout and exits 0", async () => {
  const { ctx, stdout, stderr } = makeFixture();
  const code = await route(["help"], ctx);

  assert.equal(code, 0);
  assert.equal(stderr.lines.length, 0);
  assert.match(stdout.lines.join(""), /^Usage: temple-bar <command>/);
});

void test("--help and -h alias to help", async () => {
  for (const flag of ["--help", "-h"]) {
    const { ctx, stdout } = makeFixture();
    const code = await route([flag], ctx);
    assert.equal(code, 0);
    assert.match(stdout.lines.join(""), /^Usage: temple-bar <command>/);
  }
});

void test("--version and version both print the package version and exit 0", async () => {
  for (const flag of ["--version", "version"]) {
    const { ctx, stdout } = makeFixture();
    const code = await route([flag], ctx);
    assert.equal(code, 0);
    assert.match(stdout.lines.join(""), /^\d+\.\d+\.\d+\n$/);
  }
});

void test("no arguments prints usage to stderr and exits 2", async () => {
  const { ctx, stdout, stderr } = makeFixture();
  const code = await route([], ctx);

  assert.equal(code, 2);
  assert.equal(stdout.lines.length, 0);
  assert.match(stderr.lines.join(""), /^Usage: temple-bar <command>/);
});

void test("an unknown command prints usage plus the error to stderr, exits 2, and touches nothing else", async () => {
  const { ctx, stdout, stderr, fs, git, gh } = makeFixture();
  const code = await route(["bogus"], ctx);

  assert.equal(code, 2);
  assert.equal(stdout.lines.length, 0, "nothing should reach stdout");
  const stderrText = stderr.lines.join("");
  assert.match(stderrText, /^Usage: temple-bar <command>/);
  assert.match(stderrText, /unknown command: bogus/);

  // F12 / P8.2: an unrecognised command must not write anything, or shell
  // out to git/gh.
  assert.equal(fs.writes.length, 0);
  assert.equal(git.calls.length, 0);
  assert.equal(gh.calls.length, 0);
});
