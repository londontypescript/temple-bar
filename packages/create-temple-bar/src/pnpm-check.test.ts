// The launcher's check of the child pnpm: against the pin when package.json
// has one, otherwise against the pnpm that started setup.

import assert from "node:assert/strict";
import test from "node:test";

import { main, type MainDeps } from "./main.ts";
import { checkChildPnpm } from "./pnpm-check.ts";
import type { RunOptions, RunResult } from "./runner.ts";

const OPTIONS: RunOptions = { cwd: "/app", env: { PATH: "/bin" } };
const AGENT = "pnpm/10.34.5 npm/? node/v24.0.0 darwin arm64";

function runner(result: RunResult) {
  const calls: {
    command: string;
    args: readonly string[];
    options: RunOptions;
  }[] = [];
  return {
    calls,
    run: (command: string, args: readonly string[], options: RunOptions) => {
      calls.push({ command, args, options });
      return Promise.resolve(result);
    },
  };
}

void test("launcher pnpm check: with a pin, the child pnpm must report it (a +sha512 suffix ignored)", async () => {
  const pin = '{"packageManager":"pnpm@9.15.0+sha512.abc"}';
  const ok = runner({ code: 0, stdout: "9.15.0\n" });
  assert.deepEqual(await checkChildPnpm(pin, AGENT, ok.run, OPTIONS), {});
  assert.ok(ok.calls[0]);
  assert.deepEqual(ok.calls[0].args, ["--version"]);
  assert.equal(ok.calls[0].options.capture, true);
  assert.equal(ok.calls[0].options.cwd, "/app");

  const old = runner({ code: 0, stdout: "8.1.1\n" });
  const result = await checkChildPnpm(pin, AGENT, old.run, OPTIONS);
  assert.match(result.refusal ?? "", /Nothing was changed/);
  assert.match(result.refusal ?? "", /package\.json pins pnpm 9\.15\.0/);
  assert.match(result.refusal ?? "", /found 8\.1\.1/);
  assert.match(result.refusal ?? "", /pnpm 9\.7 or newer/);
});

void test("launcher pnpm check: with no pin, the child pnpm must match the pnpm that started setup", async () => {
  const same = runner({ code: 0, stdout: "10.34.5\n" });
  assert.deepEqual(await checkChildPnpm("{}", AGENT, same.run, OPTIONS), {});

  const other = runner({ code: 0, stdout: "8.1.1\n" });
  const result = await checkChildPnpm("{}", AGENT, other.run, OPTIONS);
  assert.match(
    result.refusal ?? "",
    /the pnpm that started setup is pnpm 10\.34\.5/,
  );
  assert.match(result.refusal ?? "", /found 8\.1\.1/);

  const none = await checkChildPnpm(undefined, AGENT, same.run, OPTIONS);
  assert.deepEqual(none, {});
});

void test("launcher pnpm check: a child pnpm that fails refuses", async () => {
  const broken = runner({ code: 1, stdout: "" });
  const result = await checkChildPnpm("{}", AGENT, broken.run, OPTIONS);
  assert.match(result.refusal ?? "", /failed \(exit 1/);
  const missing = runner({ code: null });
  const gone = await checkChildPnpm("{}", AGENT, missing.run, OPTIONS);
  assert.match(gone.refusal ?? "", /failed \(exit null/);
});

void test("launcher pnpm check: an unreadable user agent with no pin skips the check with a note", async () => {
  const never = runner({ code: 0, stdout: "8.1.1\n" });
  for (const agent of [undefined, "npm/10 node/v24", "pnpm/10.34.5"]) {
    const result = await checkChildPnpm("{}", agent, never.run, OPTIONS);
    assert.equal(result.refusal, undefined);
    assert.match(result.note ?? "", /wasn't checked/);
  }
  assert.equal(never.calls.length, 0);
});

void test("launcher pnpm check: a devEngines range is noted, not compared; contradicting pins refuse", async () => {
  const never = runner({ code: 0, stdout: "8.1.1\n" });
  const range = await checkChildPnpm(
    '{"devEngines":{"packageManager":{"name":"pnpm","version":"^10"}}}',
    AGENT,
    never.run,
    OPTIONS,
  );
  assert.match(range.note ?? "", /not an exact version/);

  const conflict = await checkChildPnpm(
    '{"packageManager":"pnpm@9.0.0","devEngines":{"packageManager":{"name":"pnpm","version":"10.0.0"}}}',
    AGENT,
    never.run,
    OPTIONS,
  );
  assert.match(conflict.refusal ?? "", /contradicts itself/);
  assert.equal(never.calls.length, 0);
});

void test("launcher main: a mismatching child pnpm stops before package.json is written or anything is added", async () => {
  const written: string[] = [];
  const seen: (readonly string[])[] = [];
  const err: string[] = [];
  const deps: MainDeps = {
    argv: [],
    cwd: "/app",
    env: { npm_config_user_agent: AGENT },
    ownVersion: "0.3.0",
    fs: {
      readText: () => Promise.resolve(undefined),
      writeText: (file) => {
        written.push(file);
        return Promise.resolve();
      },
      realPath: (file) => Promise.resolve(file),
    },
    run: (_command, args) => {
      seen.push(args);
      return Promise.resolve({ code: 0, stdout: "8.1.1\n" });
    },
    stdout: { write: () => undefined },
    stderr: { write: (text) => err.push(text) },
  };
  assert.equal(await main(deps), 1);
  assert.deepEqual(written, []);
  assert.deepEqual(seen, [["--version"]]);
  assert.match(err.join(""), /Nothing was changed/);
});

void test("launcher main: --help changes nothing and runs no pnpm", async () => {
  const seen: string[] = [];
  const deps: MainDeps = {
    argv: ["--help"],
    cwd: "/app",
    env: { npm_config_user_agent: AGENT },
    ownVersion: "0.3.0",
    fs: {
      readText: () => Promise.resolve(undefined),
      writeText: () => Promise.resolve(),
      realPath: (file) => Promise.resolve(file),
    },
    run: (_command, args) => {
      seen.push(...args);
      return Promise.resolve({ code: 0 });
    },
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
  };
  assert.equal(await main(deps), 0);
  assert.deepEqual(seen, []);
});
