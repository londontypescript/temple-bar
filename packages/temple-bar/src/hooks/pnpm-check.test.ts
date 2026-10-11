// Unit tests for pnpm-check.ts through the fakes: what it asks pnpm, when it
// lets the install go ahead, and what a refusal says.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createFakeContext,
  createFakeFs,
  createFakeProc,
  createFakeWriter,
} from "../testing/fakes.ts";
import { pnpmMatchesPin } from "./pnpm-check.ts";

const WORKTREE = "/work tree";

function pin(version: string): string {
  return JSON.stringify({ packageManager: `pnpm@${version}` });
}

/** A pnpm that answers `--version` with `version`, and does not report its
 * own path (as pnpm 10 doesn't under `exec`). */
function pnpmAnswering(version: string) {
  return createFakeProc((call, options) => {
    if (call.args[0] === "--version") {
      options.stdout.write(`${version}\n`);
    }
    return 0;
  });
}

function setup(
  manifest: string | undefined,
  proc = pnpmAnswering("9.15.0"),
  files: Record<string, string> = {},
) {
  const stdout = createFakeWriter();
  const stderr = createFakeWriter();
  const fs = createFakeFs({
    ...(manifest === undefined
      ? {}
      : { [`${WORKTREE}/package.json`]: manifest }),
    ...files,
  });
  const ctx = createFakeContext({
    fs,
    proc,
    stdout,
    stderr,
    cwd: WORKTREE,
    env: { PATH: "/new/bin:/old/bin" },
  });
  return { ctx, proc, stdout, stderr };
}

void test("pnpm-check: a pnpm that reports the pinned version may install, asked in the worktree with the install's environment", async () => {
  const { ctx, proc, stderr } = setup(pin("9.15.0"));

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), true);
  assert.deepEqual(
    proc.calls.map((call) => [call.command, call.args, call.cwd, call.env]),
    [["pnpm", ["--version"], WORKTREE, { PATH: "/new/bin:/old/bin" }]],
  );
  assert.deepEqual(stderr.lines, []);
});

void test("pnpm-check: a +sha512 pin is compared without its suffix", async () => {
  const { ctx } = setup(pin("9.15.0+sha512.deadbeef"));
  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), true);
});

void test("pnpm-check: a different version refuses, naming both versions, where pnpm is (labelled probably), the fix and the hand-run steps", async () => {
  const { ctx, stderr } = setup(pin("9.15.0"), pnpmAnswering("8.1.1"), {
    "/old/bin/pnpm": "",
  });

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), false);
  const message = stderr.lines.join("");
  assert.match(message, /nothing was installed/);
  assert.match(message, /package\.json pins: pnpm 9\.15\.0/);
  assert.match(message, /found: 8\.1\.1/);
  assert.match(
    message,
    /that pnpm is at: \/old\/bin\/pnpm \(probably: the first pnpm on PATH\)/,
  );
  assert.match(message, /pnpm 9\.7 or newer, which switches itself/);
  assert.match(message, /restarted to pick up a new PATH/);
  assert.match(
    message,
    /The worktree already exists; only the install remains/,
  );
  // The path is on its own line, apart from the command.
  assert.match(message, /\ntemple-bar: {3}\/work tree\n/);
  assert.match(message, /\ntemple-bar: {3}pnpm install --frozen-lockfile\n/);
});

void test("pnpm-check: the path pnpm reports for itself is used when it reports one", async () => {
  const proc = createFakeProc((call, options) => {
    if (call.args[0] === "--version") {
      options.stdout.write("8.1.1\n");
    } else {
      options.stdout.write("/real/pnpm.cjs\n");
    }
    return 0;
  });
  const { ctx, stderr } = setup(pin("9.15.0"), proc);

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), false);
  const message = stderr.lines.join("");
  assert.match(message, /that pnpm is at: \/real\/pnpm\.cjs\n/);
  assert.doesNotMatch(message, /probably/);
});

void test("pnpm-check: a pnpm that fails to answer refuses and keeps pnpm's own stderr", async () => {
  const proc = createFakeProc((call, options) => {
    if (call.args[0] === "--version") {
      options.stderr.write("ERR_PNPM_BROKEN: could not switch\nsecond line\n");
      return 1;
    }
    return 1;
  });
  const { ctx, stderr } = setup(pin("9.15.0"), proc);

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), false);
  const message = stderr.lines.join("");
  assert.match(message, /could not say its version/);
  assert.match(message, /failed \(exit 1\)/);
  assert.match(message, /ERR_PNPM_BROKEN: could not switch/);
  assert.match(message, /second line/);
  assert.match(message, /that pnpm is at: not found/);
});

void test("pnpm-check: on Windows the .cmd shim is what is looked for on PATH", async () => {
  const { ctx, stderr } = setup(pin("9.15.0"), pnpmAnswering("8.1.1"), {
    "/old/bin/pnpm.cmd": "",
  });
  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "win32"), false);
  assert.match(stderr.lines.join(""), /\/old\/bin\/pnpm\.cmd/);
});

void test("pnpm-check: two exact versions that differ refuse before pnpm is asked anything", async () => {
  const { ctx, proc, stderr } = setup(
    JSON.stringify({
      packageManager: "pnpm@9.15.0",
      devEngines: { packageManager: { name: "pnpm", version: "10.1.0" } },
    }),
  );

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), false);
  assert.equal(proc.calls.length, 0);
  const message = stderr.lines.join("");
  assert.match(message, /package\.json contradicts itself/);
  assert.match(message, /9\.15\.0/);
  assert.match(message, /10\.1\.0/);
  assert.match(message, /only the install remains/);
});

void test("pnpm-check: a devEngines range installs with a note, and pnpm is not asked", async () => {
  const { ctx, proc, stdout } = setup(
    JSON.stringify({
      devEngines: { packageManager: { name: "pnpm", version: "^10.0.0" } },
    }),
  );

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), true);
  assert.equal(proc.calls.length, 0);
  assert.match(stdout.lines.join(""), /not an exact version.*wasn't checked/);
});

void test("pnpm-check: no pin at all installs with a note that the version wasn't checked", async () => {
  const { ctx, proc, stdout } = setup("{}");

  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), true);
  assert.equal(proc.calls.length, 0);
  assert.match(stdout.lines.join(""), /names no pnpm version.*wasn't checked/);
});

void test("pnpm-check: a missing package.json counts as no pin", async () => {
  const { ctx } = setup(undefined);
  assert.equal(await pnpmMatchesPin(ctx, WORKTREE, "linux"), true);
});
