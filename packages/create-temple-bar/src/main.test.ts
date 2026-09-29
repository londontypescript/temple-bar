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

const userAgents: Record<"pnpm" | "yarn" | "bun" | "npm", string | undefined> =
  {
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
    "@londontypescript/temple-bar@0.3.0",
  ]);
  assert.equal(firstCall.command, "pnpm");
  assert.deepEqual(calls[1], {
    command: "pnpm",
    args: ["exec", "temple-bar", "init"],
    options: { cwd: "/app", env: deps.env },
  });
});

void test("main: npm runs `npm install -D` then `npx --no-install temple-bar init`", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": "{}" });
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.npm },
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  await main(deps);
  const [first, second] = calls;
  assert.deepEqual(first?.args, [
    "install",
    "-D",
    "@londontypescript/temple-bar@0.3.0",
  ]);
  assert.deepEqual(second?.args, ["--no-install", "temple-bar", "init"]);
  assert.equal(second.command, "npx");
});

void test("main: yarn runs `yarn add -D` then `yarn exec temple-bar init`", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": "{}" });
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.yarn },
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  await main(deps);
  assert.deepEqual(calls[0], {
    command: "yarn",
    args: ["add", "-D", "@londontypescript/temple-bar@0.3.0"],
    options: { cwd: "/app", env: deps.env },
  });
  assert.deepEqual(calls[1]?.args, ["exec", "temple-bar", "init"]);
});

void test("main: bun runs `bun add -d` then `bunx temple-bar init`", async () => {
  const { run, calls } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": "{}" });
  const deps: MainDeps = {
    cwd: "/app",
    env: { npm_config_user_agent: userAgents.bun },
    ownVersion: "0.3.0",
    fs,
    run,
    stderr: makeFakeWriter(),
  };
  await main(deps);
  assert.deepEqual(calls[0]?.args, [
    "add",
    "-d",
    "@londontypescript/temple-bar@0.3.0",
  ]);
  assert.deepEqual(calls[1], {
    command: "bunx",
    args: ["temple-bar", "init"],
    options: { cwd: "/app", env: deps.env },
  });
});

void test("main: creates package.json when none exists", async () => {
  const { run } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs();
  const deps: MainDeps = {
    cwd: "/my-app",
    env: {},
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
  assert.equal(written.name, "my-app");
  assert.equal(written.private, true);
});

void test("main: leaves an existing package.json alone", async () => {
  const { run } = makeFakeRunner(() => ({ code: 0 }));
  const fs = makeFakeFs({ "/app/package.json": '{"name":"already-here"}' });
  const deps: MainDeps = {
    cwd: "/app",
    env: {},
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
