import assert from "node:assert/strict";
import { normalize } from "node:path";
import test from "node:test";

import { main, type FsLike, type MainDeps, type WriterLike } from "./main.ts";
import type { RunOptions, RunResult } from "./runner.ts";

interface RecordedRun {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: RunOptions;
}

/** Keys are normalised the way the real filesystem treats them, so the
 * tests' "/app/x" and main's path.join (backslashes on Windows) match. */
function makeFakeFs(initial: Record<string, string> = {}): FsLike & {
  file(filePath: string): string | undefined;
} {
  const files = new Map(
    Object.entries(initial).map(([key, value]) => [normalize(key), value]),
  );
  return {
    file: (filePath) => files.get(normalize(filePath)),
    readText: (filePath) => Promise.resolve(files.get(normalize(filePath))),
    writeText: (filePath, content) => {
      files.set(normalize(filePath), content);
      return Promise.resolve();
    },
  };
}

function makeFakeRunner(
  script: (command: string, args: readonly string[]) => RunResult,
) {
  const calls: RecordedRun[] = [];
  const run = (
    command: string,
    args: readonly string[],
    options: RunOptions,
  ) => {
    calls.push({ command, args, options });
    return Promise.resolve(script(command, args));
  };
  return { run, calls };
}

function makeFakeWriter(): WriterLike & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (text) => lines.push(text) };
}

const userAgents = {
  pnpm: "pnpm/9.1.0 node/v24.0.0",
  yarn: "yarn/4.1.0 node/v24.0.0",
  bun: "bun/1.1.0",
  npm: "npm/10.0.0 node/v24.0.0",
};

void test("main: pnpm runs `pnpm add -D` then `pnpm exec temple-bar init`", async () => {
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
  assert.deepEqual(calls[1], {
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

  assert.equal(calls.length, 2);
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

function refusalFixture(
  userAgent: string | undefined,
  files: Record<string, string> = { "/app/package.json": "{}" },
) {
  const fs = makeFakeFs(files);
  const writes: string[] = [];
  const guarded: FsLike = {
    readText: (filePath) => fs.readText(filePath),
    writeText: (filePath, content) => {
      writes.push(filePath);
      return fs.writeText(filePath, content);
    },
  };
  const runner = makeFakeRunner(() => ({ code: 0 }));
  const stdout = makeFakeWriter();
  const stderr = makeFakeWriter();
  const deps: MainDeps = {
    argv: [],
    cwd: "/app",
    env: userAgent === undefined ? {} : { npm_config_user_agent: userAgent },
    ownVersion: "0.3.0",
    fs: guarded,
    run: runner.run,
    stdout,
    stderr,
  };
  return { deps, runner, writes, stdout, stderr };
}

for (const manager of ["npm", "yarn", "bun"] as const) {
  void test(`main: \`${manager} create\` is refused with a helpful message and changes nothing`, async () => {
    const { deps, runner, writes, stderr } = refusalFixture(
      userAgents[manager],
      { "/app/package.json": '{"packageManager":"npm@10.9.2"}' },
    );
    const code = await main(deps);
    assert.equal(code, 1);
    assert.equal(runner.calls.length, 0, "nothing may be spawned");
    assert.deepEqual(writes, [], "nothing may be written");
    const text = stderr.lines.join("");
    assert.match(text, /temple-bar needs pnpm/);
    assert.match(text, /this wasn't started with pnpm/);
    assert.match(text, /npm install -g pnpm/);
    assert.match(text, /https:\/\/pnpm\.io\/installation/);
    assert.match(text, /pnpm create @londontypescript\/temple-bar@latest/);
  });
}

void test("main: a launch with no package manager at all is refused", async () => {
  const { deps, runner, writes } = refusalFixture(undefined);
  assert.equal(await main(deps), 1);
  assert.equal(runner.calls.length, 0);
  assert.deepEqual(writes, []);
});

for (const lockfile of [
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
]) {
  void test(`main: a ${lockfile} in the repo is refused even under pnpm, changing nothing`, async () => {
    const { deps, runner, writes, stderr } = refusalFixture(userAgents.pnpm, {
      "/app/package.json": "{}",
      [`/app/${lockfile}`]: "",
    });
    const code = await main(deps);
    assert.equal(code, 1);
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(writes, []);
    const text = stderr.lines.join("");
    assert.ok(text.includes(lockfile), "names the lockfile it found");
    assert.match(text, /https:\/\/pnpm\.io\/installation/);
    assert.match(text, /pnpm create @londontypescript\/temple-bar@latest/);
  });
}

void test("main: a refused launch does not create package.json", async () => {
  const { deps, writes } = refusalFixture(userAgents.npm, {});
  await main(deps);
  assert.deepEqual(writes, []);
});

void test("main: packageManager refuses foreign strings before writes or runs and leaves other manifests to installation", async () => {
  const cases: readonly [string | undefined, string | undefined][] = [
    ['{"packageManager":"npm@10.9.2"}', "npm@10.9.2"],
    ['{"packageManager":"yarn@4.1.0"}', "yarn@4.1.0"],
    ['{"packageManager":"bun@1.1.0"}', "bun@1.1.0"],
    ['{"packageManager":"pnpm@10.34.5"}', undefined],
    ['{"packageManager":"pnpm@10.34.5+sha512.abcdef"}', undefined],
    ["{}", undefined],
    ['{"packageManager":""}', undefined],
    [undefined, undefined],
    ["{", undefined],
    ['{"packageManager":42}', undefined],
    ['{"packageManager":null}', undefined],
    ['{"packageManager":false}', undefined],
    ['{"packageManager":{}}', undefined],
    ['{"packageManager":[]}', undefined],
    ["null", undefined],
  ];
  for (const [contents, foreign] of cases) {
    const { deps, runner, writes, stderr, stdout } = refusalFixture(
      userAgents.pnpm,
      contents === undefined ? {} : { "/app/package.json": contents },
    );
    assert.equal(await main(deps), foreign === undefined ? 0 : 1, contents);
    assert.deepEqual(stdout.lines, []);
    if (foreign !== undefined) {
      assert.equal(runner.calls.length, 0, "nothing may be spawned");
      assert.deepEqual(writes, [], "nothing may be written");
      const message = stderr.lines.join("");
      assert.ok(message.includes(foreign));
      assert.match(message, /temple-bar needs pnpm/);
      assert.match(message, /"packageManager": "pnpm@[^"\n]+"/);
      assert.match(message, /framework's pnpm option/);
      assert.match(message, /pnpm create @londontypescript\/temple-bar@latest/);
      assert.doesNotMatch(message, /install/i);
    } else {
      assert.deepEqual(stderr.lines, []);
      assert.deepEqual(
        runner.calls.map((call) => call.args[0]),
        ["add", "exec"],
      );
      assert.deepEqual(
        writes,
        contents === undefined ? [normalize("/app/package.json")] : [],
      );
    }
  }
});

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
  assert.deepEqual(calls[1]?.args, [
    "exec",
    "temple-bar",
    "init",
    "--create-repo",
  ]);
});
