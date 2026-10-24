// Everything the Windows runner needs from the machine, behind one interface:
// files, the clock, the process table, git, and running a step. The real
// version is in real.ts; tests pass a fake, so the runner's logic is checked
// on any system.

import type { FsLike } from "./fsx.ts";

export interface ProcInfo {
  readonly pid: number;
  readonly name: string;
  /** When it started, in ms. Null when the account may not read it, which
   * is the case for every process that is not its own. */
  readonly startMs: number | null;
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface StepSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface StepOutcome {
  /** Null when the process could not be started or was stopped for time. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

export interface Sys {
  readonly home: string;
  /** The null device, which git's hooks path is pointed at to turn hooks off. */
  readonly devNull: string;
  readonly tmpdir: string;
  readonly osRelease: string;
  readonly osVersion: string;
  /** This runner, and the process that launched it (the shell the SSH
   * server started). */
  readonly self: {
    readonly pid: number;
    readonly ppid: number;
    readonly startMs: number;
  };
  readonly fs: FsLike;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Writes to the terminal on the other end of the connection. */
  print(text: string): void;
  listProcesses(): Promise<ProcInfo[]>;
  /** One process's start time now, or null if it is gone or unreadable. */
  startOf(pid: number): Promise<number | null>;
  kill(pid: number): void;
  git(args: readonly string[], cwd?: string): Promise<GitResult>;
  /** Runs one fixed step, passing each whole line of its output (stdout and
   * stderr alike) to `onLine` as it comes. */
  runStep(
    spec: StepSpec,
    timeoutMs: number,
    onLine: (line: string) => void,
  ): Promise<StepOutcome>;
  /** Runs a fixed command, from `cwd` when given, and returns its stdout,
   * or null if it failed. */
  probe(
    command: string,
    args: readonly string[],
    cwd?: string,
  ): Promise<string | null>;
  /** Where the command resolves on PATH, or null. */
  where(command: string): Promise<string | null>;
  /** The file's canonical path, or null if it can't be read. */
  realpath(file: string): Promise<string | null>;
  /** Starts a chain of `depth` processes, each the child of the one before,
   * and returns their pids, top first. Fewer if they would not all start. */
  startTree(depth: number): Promise<number[]>;
  /** Stops the tree `startTree` started, from `pid` (its top) down, with
   * `taskkill /T`, and returns taskkill's exit code. Null, stopping nothing,
   * when the top process has already exited: its pid may be reused. */
  stopTree(pid: number): Promise<number | null>;
}
