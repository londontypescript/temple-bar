import assert from "node:assert/strict";
import { normalize } from "node:path";
import test from "node:test";

import { main, type MainDeps } from "./main.ts";
import type { RunOptions, RunResult } from "./runner.ts";

const env = { npm_config_user_agent: "pnpm/10.34.5 node/v24.0.0" };

function setup(
  files: Record<string, string>,
  listResult: RunResult = {
    code: 0,
    stdout: JSON.stringify([
      { path: "/ws" },
      { path: "/ws/packages/a" },
      { path: "/ws/packages/b" },
    ]),
  },
) {
  const store = new Map(
    Object.entries(files).map(([key, value]) => [normalize(key), value]),
  );
  const writes: string[] = [];
  const calls: { args: readonly string[]; options: RunOptions }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: MainDeps = {
    argv: [],
    cwd: "/ws",
    env,
    ownVersion: "0.3.0",
    fs: {
      readText: (filePath) => Promise.resolve(store.get(normalize(filePath))),
      writeText: (filePath, content) => {
        writes.push(filePath);
        store.set(normalize(filePath), content);
        return Promise.resolve();
      },
      realPath: (filePath) => Promise.resolve(filePath),
    },
    run: (_command, args, options) => {
      if (args[0] === "--version") {
        return Promise.resolve({ code: 0, stdout: "10.34.5\n" });
      }
      calls.push({ args, options });
      return Promise.resolve(args[0] === "list" ? listResult : { code: 0 });
    },
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  };
  return { deps, calls, writes, err: () => err.join("") };
}

const workspace = {
  "/ws/package.json": '{"name":"root","private":true}',
  "/ws/pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
};

void test("main: at a workspace root the dependency is added with -w, and init follows", async () => {
  const { deps, calls } = setup(workspace);
  assert.equal(await main(deps), 0);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["list", "add", "install", "exec"],
  );
  assert.deepEqual(calls[1]?.args, [
    "add",
    "-Dw",
    "--save-exact",
    "@londontypescript/temple-bar@0.3.0",
  ]);
  assert.equal(calls[0]?.options.capture, true);
});

void test("main: outside a workspace nothing is listed and the add has no -w", async () => {
  const { deps, calls } = setup({ "/ws/package.json": "{}" });
  assert.equal(await main(deps), 0);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["add", "install", "exec"],
  );
  assert.deepEqual(calls[0]?.args.slice(0, 3), ["add", "-D", "--save-exact"]);
});

void test("main: a failed add prints the command that was actually run, with -w", async () => {
  const { deps, err } = setup(workspace);
  const run = deps.run;
  const failing: MainDeps = {
    ...deps,
    run: (command, args, options) =>
      args[0] === "add"
        ? Promise.resolve({ code: 1 })
        : run(command, args, options),
  };
  assert.equal(await main(failing), 1);
  assert.match(err(), /ran: pnpm add -Dw --save-exact /);
});

for (const leftover of [
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "pnpm-workspace.yaml",
]) {
  void test(`main: a ${leftover} inside a package is refused and nothing is changed`, async () => {
    const { deps, calls, writes, err } = setup({
      ...workspace,
      [`/ws/packages/b/${leftover}`]: "x",
    });
    assert.equal(await main(deps), 1);
    assert.match(err(), /Nothing was changed/);
    assert.ok(err().includes(leftover), err());
    assert.deepEqual(writes, []);
    assert.deepEqual(
      calls.map((call) => call.args[0]),
      ["list"],
    );
  });
}

void test("main: a root with no package.json is not created when a package is refused", async () => {
  const { deps, writes } = setup({
    "/ws/pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "/ws/packages/a/yarn.lock": "x",
  });
  assert.equal(await main(deps), 1);
  assert.deepEqual(writes, []);
});

void test("main: every leftover is named, and per-package files are left alone", async () => {
  const { deps, err } = setup({
    ...workspace,
    "/ws/packages/a/pnpm-lock.yaml": "x",
    "/ws/packages/b/yarn.lock": "x",
    "/ws/packages/b/eslint.config.js": "x",
    "/ws/packages/b/.gitignore": "x",
  });
  assert.equal(await main(deps), 1);
  assert.ok(err().includes("pnpm-lock.yaml"));
  assert.ok(err().includes("yarn.lock"));
  assert.ok(!err().includes("eslint.config.js"));
});

void test("main: a failed package listing stops with a clear message and changes nothing", async () => {
  const { deps, calls, writes, err } = setup(workspace, { code: 1 });
  assert.equal(await main(deps), 1);
  assert.match(err(), /could not list this workspace's packages/);
  assert.match(err(), /Nothing was changed/);
  assert.deepEqual(writes, []);
  assert.equal(calls.length, 1);
});

void test("main: a listing in an unexpected shape stops instead of guessing", async () => {
  const { deps, err } = setup(workspace, {
    code: 0,
    stdout: '{"not":"a list"}',
  });
  assert.equal(await main(deps), 1);
  assert.match(err(), /wasn't a package list/);
});
