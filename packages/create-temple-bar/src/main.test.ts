import assert from "node:assert/strict";
import test from "node:test";

import { main, type FsLike, type MainDeps } from "./main.ts";
import {
  makeFakeFs,
  makeFakeRunner,
  makeFakeWriter,
  type RecordedRun,
  refusalFixture,
  userAgents,
} from "./testing/fakes.ts";

void test("main: pnpm adds the dependency, finishes install, then initializes", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": "{}" });
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.pnpm },
    argv: [],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  const code = await main(deps);
  assert.equal(code, 0);
  const firstCall = calls[0];
  assert.deepEqual(firstCall?.args, [
    "add",
    "-D",
    "--save-exact",
    "@londontypescript/temple-bar@0.3.0",
  ]);
  assert.equal(firstCall.command, "pnpm");
  assert.deepEqual(calls[1]?.args, ["install", "--frozen-lockfile"]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], {
    command: "pnpm",
    args: ["exec", "temple-bar", "init"],
    options: { cwd: "/app", env: deps.env },
  });
});

void test("main: creates a private package.json without a name before installation", async () => {
  const fs = makeFakeFs();
  const { run } = makeFakeRunner(() => {
    assert.equal(fs.file("/my-app/package.json"), '{\n  "private": true\n}\n');
    return { code: 0 };
  });
  const deps: MainDeps = {
    cwd: "/my-app",
    env: { npm_config_user_agent: userAgents.pnpm },
    argv: [],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  await main(deps);
  const written = JSON.parse(fs.file("/my-app/package.json") ?? "{}") as {
    name: string;
    private: boolean;
  };
  assert.equal(Object.hasOwn(written, "name"), false);
  assert.equal(written.private, true);
});

void test("main: leaves an existing package.json alone", async () => {
  const { run } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": '{"name":"already-here"}' });
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.pnpm },
    argv: [],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  await main(deps);
  assert.equal(fs.file("/app/package.json"), '{"name":"already-here"}');
});

void test("main: a failing add-dependency step stops before running init", async () => {
  const calls: RecordedRun[] = [];
  const fs = makeFakeFs({ "/app/package.json": "{}" });
  const stderr = makeFakeWriter();
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.pnpm },
    argv: [],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs,
    run: (command, args, options) => {
      if (args[0] === "--version") {
        return Promise.resolve({ code: 0, stdout: "9.1.0\n" });
      }
      calls.push({ command, args, options });
      return Promise.resolve({ code: 1 });
    },
    stderr,
  };
  const code = await main(deps);
  assert.equal(code, 1);
  assert.equal(calls.length, 1, "init must never run after a failed add");
  assert.match(stderr.lines.join(""), /Failed to add/);
});

void test("main: the launcher's own commands don't inherit npm exec's --package", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const deps: MainDeps = {
    cwd: "/app",
    env: {
      npm_config_user_agent: userAgents.pnpm,
      npm_config_package: "@londontypescript/create-temple-bar",
      KEEP: "me",
    },
    argv: [],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs: makeFakeFs({ "/app/package.json": "{}" }),
    run,
    stderr: makeFakeWriter(),
  };

  await main(deps);

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.options.env.npm_config_package, undefined);
    assert.equal(call.options.env.KEEP, "me");
  }
});

for (const flag of ["--help", "-h"]) {
  void test(`main: ${flag} prints help to stdout, exits 0 and touches nothing`, async () => {
    const reads: string[] = [];
    const writes: string[] = [];
    const fs: FsLike = {
      readText: (filePath) => {
        reads.push(filePath);
        return Promise.resolve(undefined);
      },
      writeText: (filePath) => {
        writes.push(filePath);
        return Promise.resolve();
      },
      realPath: (filePath) => Promise.resolve(filePath),
    };
    const runner = makeFakeRunner(() => ({ code: 0 }));
    const stdout = makeFakeWriter();
    const stderr = makeFakeWriter();
    const code = await main({
      argv: [flag],
      stdout,
      cwd: "/app",
      env: { npm_config_user_agent: userAgents.npm },
      ownVersion: "0.3.0",
      fs,
      run: runner.run,
      stderr,
    });
    assert.equal(code, 0);
    assert.ok(
      stdout.lines
        .join("")
        .startsWith("Usage: pnpm create @londontypescript/temple-bar@latest"),
    );
    assert.deepEqual(stderr.lines, []);
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    assert.equal(runner.calls.length, 0);
  });
}

void test("main: the approval flags reach `temple-bar init`", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const code = await main({
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.pnpm },
    argv: ["--create-repo"],
    stdout: makeFakeWriter(),
    ownVersion: "0.3.0",
    fs: makeFakeFs({ "/app/package.json": "{}" }),
    run,
    stderr: makeFakeWriter(),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls[2]?.args, [
    "exec",
    "temple-bar",
    "init",
    "--create-repo",
  ]);
});

for (const failure of [7, null]) {
  void test(`main: install exit ${String(failure)} stops before init`, async () => {
    const { deps, stderr } = refusalFixture(userAgents.pnpm);
    const runner = makeFakeRunner((_command, args) => ({
      code: args[0] === "install" ? failure : 0,
    }));
    assert.equal(await main({ ...deps, run: runner.run }), failure ?? 1);
    assert.deepEqual(
      runner.calls.map((call) => call.args[0]),
      ["add", "install"],
    );
    assert.match(stderr.lines.join(""), /Failed to install the project/);
    assert.match(stderr.lines.join(""), /ran: pnpm install --frozen-lockfile/);
  });
}
