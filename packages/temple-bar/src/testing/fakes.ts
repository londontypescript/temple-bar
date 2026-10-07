// In-memory fakes for every seam, for tests only. Excluded from the built
// package (tsconfig.build.json).

import { dirname, normalize, resolve } from "node:path";

import type { Context } from "../context.ts";
import type { ClockSeam } from "../seams/clock.ts";
import type { FsSeam } from "../seams/fs.ts";
import type { GhResult, GhSeam } from "../seams/gh.ts";
import type { GitResult, GitSeam } from "../seams/git.ts";
import type { HttpResult, HttpSeam } from "../seams/http.ts";
import type { Writer } from "../seams/io.ts";
import type { ProcRunOptions, ProcSeam } from "../seams/proc.ts";
import type { ConfirmResult, PromptSeam } from "../seams/prompt.ts";

interface RecordedCall {
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

interface RecordedGhCall extends RecordedCall {
  readonly input?: string;
}

export interface FakeGh extends GhSeam {
  readonly calls: RecordedGhCall[];
}

export function createFakeGh(
  script: (args: readonly string[], cwd: string) => GhResult = () => ({
    code: 0,
    stdout: "",
    stderr: "",
    notFound: false,
  }),
): FakeGh {
  const calls: RecordedGhCall[] = [];
  return {
    calls,
    run(args, cwd, input) {
      calls.push(input === undefined ? { args, cwd } : { args, cwd, input });
      return Promise.resolve(script(args, cwd));
    },
  };
}

interface RecordedHttpCall {
  readonly url: string;
  readonly token: string | undefined;
}

export interface FakeHttp extends HttpSeam {
  readonly calls: RecordedHttpCall[];
}

/** By default every request is a network failure, so a test that reaches
 * the network without meaning to fails loudly instead of passing. */
export function createFakeHttp(
  script: (url: string, token: string | undefined) => HttpResult = () => ({
    kind: "network-error",
    message: "no network in tests",
  }),
): FakeHttp {
  const calls: RecordedHttpCall[] = [];
  return {
    calls,
    get(url, token) {
      calls.push({ url, token });
      return Promise.resolve(script(url, token));
    },
  };
}

interface RecordedWrite {
  /** Normalised like PathMap's keys: compare with path.normalize(...). */
  readonly path: string;
  readonly content: string;
}

export interface FakeFs extends FsSeam {
  readonly files: Map<string, string>;
  readonly writes: RecordedWrite[];
  /** Paths that are symlinks. Reading one throws, like a symlink to a
   * directory does on a real disk (EISDIR). */
  readonly symlinks: Set<string>;
  /** Stored targets for links that should behave like real links. The older
   * symlinks set keeps its existing read-error behaviour. */
  readonly linkTargets: Map<string, string>;
  readonly directories: Set<string>;
  readonly classificationErrors: Map<string, Error>;
}

/** A Map whose keys are paths normalised the way the real filesystem
 * treats them, so a test's "/repo/x" and the code's path.join(cwd, "x")
 * (backslashes on Windows) name the same file, whether read through the
 * seam or straight from `files` in a test. */
class PathMap extends Map<string, string> {
  override get(key: string): string | undefined {
    return super.get(normalize(key));
  }
  override set(key: string, value: string): this {
    return super.set(normalize(key), value);
  }
  override has(key: string): boolean {
    return super.has(normalize(key));
  }
  override delete(key: string): boolean {
    return super.delete(normalize(key));
  }
}

/** A Set of paths normalised like PathMap's keys, so a test's "/repo/x"
 * matches the code's path.join(...) on Windows too. */
class PathSet extends Set<string> {
  override add(value: string): this {
    return super.add(normalize(value));
  }
  override has(value: string): boolean {
    return super.has(normalize(value));
  }
  override delete(value: string): boolean {
    return super.delete(normalize(value));
  }
}

export function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const files = new PathMap(Object.entries(initial));
  const writes: RecordedWrite[] = [];
  const symlinks = new PathSet();
  const linkTargets = new PathMap();
  const directories = new PathSet();
  const classificationErrors = new Map<string, Error>();
  return {
    files,
    writes,
    symlinks,
    linkTargets,
    directories,
    classificationErrors,
    classify(path) {
      const error = classificationErrors.get(normalize(path));
      if (error !== undefined) return Promise.reject(error);
      if (symlinks.has(path) || linkTargets.has(path))
        return Promise.resolve("symlink");
      if (files.has(path)) return Promise.resolve("file");
      const prefix = normalize(`${path}/`);
      return Promise.resolve(
        directories.has(path) ||
          [
            ...files.keys(),
            ...linkTargets.keys(),
            ...symlinks,
            ...directories,
          ].some((file) => file.startsWith(prefix))
          ? "directory"
          : "missing",
      );
    },
    readlink(path) {
      const target = linkTargets.get(path);
      return target === undefined
        ? Promise.reject(new Error(`No stored link target for '${path}'`))
        : Promise.resolve(target);
    },
    readText(path) {
      if (symlinks.has(path)) {
        return Promise.reject(
          new Error(`EISDIR: illegal operation on a directory, read '${path}'`),
        );
      }
      const target = linkTargets.get(path);
      return Promise.resolve(
        files.get(target === undefined ? path : resolve(dirname(path), target)),
      );
    },
    writeText(path, content) {
      const target = linkTargets.get(path);
      files.set(
        target === undefined ? path : resolve(dirname(path), target),
        content,
      );
      writes.push({ path: normalize(path), content });
      return Promise.resolve();
    },
    exists(path) {
      // A folder exists, as on a real disk, when some file is inside it.
      const target = linkTargets.get(path);
      const entry =
        target === undefined ? path : resolve(dirname(path), target);
      const folder = normalize(`${entry}/`);
      return Promise.resolve(
        files.has(entry) ||
          directories.has(entry) ||
          [...files.keys(), ...directories].some((f) => f.startsWith(folder)),
      );
    },
    isRegularFile(path) {
      return Promise.resolve(
        files.has(path) && !symlinks.has(path) && !linkTargets.has(path),
      );
    },
    mkdirp(path) {
      directories.add(path);
      return Promise.resolve();
    },
    chmod() {
      return Promise.resolve();
    },
    copyNew(from, to) {
      const content = files.get(from);
      if (content === undefined) {
        return Promise.reject(new Error(`ENOENT: no such file, '${from}'`));
      }
      if (files.has(to)) {
        return Promise.resolve(false);
      }
      files.set(to, content);
      writes.push({ path: normalize(to), content });
      return Promise.resolve(true);
    },
  };
}

export interface RecordedProcCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export interface FakeProc extends ProcSeam {
  readonly calls: RecordedProcCall[];
}

/**
 * `script` decides the exit code for each call and may also write to the
 * call's stdout/stderr writers (`options.stdout`/`options.stderr`), the way
 * the real seam streams output.
 */
export function createFakeProc(
  script: (call: RecordedProcCall, options: ProcRunOptions) => number = () => 0,
): FakeProc {
  const calls: RecordedProcCall[] = [];
  return {
    calls,
    run(command, args, options) {
      const call: RecordedProcCall = {
        command,
        args,
        cwd: options.cwd,
        env: options.env,
      };
      calls.push(call);
      return Promise.resolve(script(call, options));
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
    http: createFakeHttp(),
    fs: createFakeFs(),
    clock: createFakeClock(),
    prompt: createFakePrompt(),
    proc: createFakeProc(),
    stdout: createFakeWriter(),
    stderr: createFakeWriter(),
    cwd: "/repo",
    env: {},
    ...overrides,
  };
}
