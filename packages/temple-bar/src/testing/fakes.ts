// In-memory fakes for every seam, for tests only. Excluded from the built
// package (tsconfig.build.json).

import type { Context } from "../context.ts";
import type { ClockSeam } from "../seams/clock.ts";
import type { FsSeam } from "../seams/fs.ts";
import type { GhResult, GhSeam } from "../seams/gh.ts";
import type { GitResult, GitSeam } from "../seams/git.ts";
import type { Writer } from "../seams/io.ts";
import type { ConfirmResult, PromptSeam } from "../seams/prompt.ts";

export interface RecordedCall {
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface FakeGit extends GitSeam {
  readonly calls: RecordedCall[];
}

export function createFakeGit(
  script: (args: readonly string[], cwd: string) => GitResult = () => ({
    code: 0,
    stdout: "",
    stderr: "",
  }),
): FakeGit {
  const calls: RecordedCall[] = [];
  return {
    calls,
    run(args, cwd) {
      calls.push({ args, cwd });
      return Promise.resolve(script(args, cwd));
    },
  };
}

export interface FakeGh extends GhSeam {
  readonly calls: RecordedCall[];
}

export function createFakeGh(
  script: (args: readonly string[], cwd: string) => GhResult = () => ({
    code: 0,
    stdout: "",
    stderr: "",
    notFound: false,
  }),
): FakeGh {
  const calls: RecordedCall[] = [];
  return {
    calls,
    run(args, cwd) {
      calls.push({ args, cwd });
      return Promise.resolve(script(args, cwd));
    },
  };
}

export interface RecordedWrite {
  readonly path: string;
  readonly content: string;
}

export interface FakeFs extends FsSeam {
  readonly files: Map<string, string>;
  readonly writes: RecordedWrite[];
}

export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new Map(Object.entries(initial));
  const writes: RecordedWrite[] = [];
  return {
    files,
    writes,
    readText(path) {
      return Promise.resolve(files.get(path));
    },
    writeText(path, content) {
      files.set(path, content);
      writes.push({ path, content });
      return Promise.resolve();
    },
    exists(path) {
      return Promise.resolve(files.has(path));
    },
    mkdirp() {
      return Promise.resolve();
    },
    chmod() {
      return Promise.resolve();
    },
  };
}

export function createFakeClock(
  date: Date = new Date("2026-09-28T00:00:00.000Z"),
): ClockSeam {
  return { now: () => date };
}

export function createFakePrompt(
  options: { interactive?: boolean; answer?: ConfirmResult } = {},
): PromptSeam {
  const interactive = options.interactive ?? false;
  const answer = options.answer ?? "no-terminal";
  return {
    isInteractive: () => interactive,
    confirm: () => Promise.resolve(answer),
  };
}

export interface FakeWriter extends Writer {
  readonly lines: string[];
}

export function createFakeWriter(): FakeWriter {
  const lines: string[] = [];
  return {
    lines,
    write(text) {
      lines.push(text);
    },
  };
}

export function createFakeContext(overrides: Partial<Context> = {}): Context {
  return {
    git: createFakeGit(),
    gh: createFakeGh(),
    fs: createFakeFs(),
    clock: createFakeClock(),
    prompt: createFakePrompt(),
    stdout: createFakeWriter(),
    stderr: createFakeWriter(),
    cwd: "/repo",
    env: {},
    ...overrides,
  };
}
