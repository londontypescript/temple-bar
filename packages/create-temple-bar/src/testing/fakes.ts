// Fakes for the launcher's seams, shared by the tests of main(). Each one
// records what main asked of it, so a test can check what was run, written
// or printed without touching the disk or spawning anything.

import { normalize } from "node:path";

import type { FsLike, MainDeps, WriterLike } from "../main.ts";
import type { RunOptions, RunResult } from "../runner.ts";

export interface RecordedRun {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: RunOptions;
}

/** Keys are normalised the way the real filesystem treats them, so the
 * tests' "/app/x" and main's path.join (backslashes on Windows) match. */
export function makeFakeFs(initial: Record<string, string> = {}): FsLike & {
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
    realPath: (filePath) => Promise.resolve(filePath),
  };
}

export function makeFakeRunner(
  script: (command: string, args: readonly string[]) => RunResult,
) {
  const calls: RecordedRun[] = [];
  const run = (
    command: string,
    args: readonly string[],
    options: RunOptions,
  ) => {
    // The check that the child pnpm is the one that started setup (the user
    // agent below says 9.1.0). It has its own tests in pnpm-check.test.ts.
    if (args[0] === "--version") {
      return Promise.resolve<RunResult>({ code: 0, stdout: "9.1.0\n" });
    }
    calls.push({ command, args, options });
    return Promise.resolve(script(command, args));
  };
  return { run, calls };
}

export function makeFakeWriter(): WriterLike & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (text) => lines.push(text) };
}

export const userAgents = {
  pnpm: "pnpm/9.1.0 node/v24.0.0",
  yarn: "yarn/4.1.0 node/v24.0.0",
  bun: "bun/1.1.0",
  npm: "npm/10.0.0 node/v24.0.0",
};

export function refusalFixture(
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
    realPath: (filePath) => fs.realPath(filePath),
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
