import assert from "node:assert/strict";
import test from "node:test";

import type { Context } from "./context.ts";
import { createRegistry, route } from "./router.ts";
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

void test("the real registry has every shipped command", () => {
  const registry = createRegistry();
  for (const name of ["help", "version", "init", "gate", "hook"]) {
    assert.ok(registry.get(name), `missing command: ${name}`);
  }
});

/** Wraps each seam so any method call on it is recorded in `touched`. */
function spyOn<T extends object>(name: string, seam: T, touched: string[]): T {
  return new Proxy(seam, {
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]): unknown => {
        touched.push(`${name}.${String(property)}`);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

function makeSpiedFixture(): TestFixture & { touched: string[] } {
  const fixture = makeFixture();
  const touched: string[] = [];
  const base = fixture.ctx;
  const ctx: Context = {
    ...base,
    git: spyOn("git", base.git, touched),
    gh: spyOn("gh", base.gh, touched),
    fs: spyOn("fs", base.fs, touched),
    clock: spyOn("clock", base.clock, touched),
    prompt: spyOn("prompt", base.prompt, touched),
    proc: spyOn("proc", base.proc, touched),
  };
  return { ...fixture, ctx, touched };
}

void test("--help and -h after any command print that command's help, exit 0, and run nothing", async () => {
  const registry = createRegistry();
  for (const entry of registry.list()) {
    for (const flag of ["--help", "-h"]) {
      const { ctx, stdout, stderr, touched } = makeSpiedFixture();
      const code = await route([entry.name, flag], ctx, registry);

      const label = `${entry.name} ${flag}`;
      assert.equal(code, 0, label);
      assert.equal(stderr.lines.join(""), "", label);
      const text = stdout.lines.join("");
      assert.ok(
        text.startsWith(`Usage: temple-bar ${entry.name}`),
        `${label}: ${text}`,
      );
      assert.ok(text.includes(entry.summary), `${label}: ${text}`);
      assert.deepEqual(touched, [], `${label} must not touch any seam`);
    }
  }
});

void test("--help after a hook subcommand still shows help instead of running the hook", async () => {
  for (const args of [
    ["hook", "pre-commit", "--help"],
    ["hook", "install", "-h"],
    ["hook", "reference-transaction", "prepared", "--help"],
  ]) {
    const { ctx, stdout, touched } = makeSpiedFixture();
    const code = await route(args, ctx);

    assert.equal(code, 0, args.join(" "));
    assert.match(
      stdout.lines.join(""),
      /^Usage: temple-bar hook <pre-commit\|reference-transaction <state>\|install>\n/,
    );
    assert.deepEqual(touched, [], `${args.join(" ")} must not touch any seam`);
  }
});

void test("gate --help describes the checks the gate requires", async () => {
  const { ctx, stdout } = makeSpiedFixture();
  await route(["gate", "--help"], ctx);
  assert.match(stdout.lines.join(""), /typecheck, lint, format:check, test/);
});
