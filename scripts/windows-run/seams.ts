// What the local side needs from the machine it runs on, behind interfaces so
// its logic is tested with fakes: git, ssh and scp, the filesystem, the clock
// and randomness, and asking whether another run's process is still alive.

import type { FsLike } from "./remote/fsx.ts";

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Git {
  run(args: readonly string[], cwd: string): Promise<GitResult>;
}

export interface Ssh {
  /** Runs `remote` on the host, passing the runner's output chunks on as they
   * arrive. Resolves ssh's own exit code (255 when it could not connect). */
  exec(
    host: string,
    remote: readonly string[],
    onStdout: (chunk: Buffer) => void,
    onStderr: (chunk: Buffer) => void,
  ): Promise<number>;
  /** Copies a file or, with `recursive`, a folder into the host's `dest`. */
  copy(
    host: string,
    localPath: string,
    dest: string,
    recursive: boolean,
  ): Promise<number>;
}

interface Writer {
  write(text: string): void;
}

export interface LocalDeps {
  readonly cwd: string;
  readonly git: Git;
  readonly ssh: Ssh;
  readonly fs: FsLike;
  readonly stdout: Writer;
  readonly stderr: Writer;
  /** A fresh empty folder for what is sent. */
  makeTempDir(): Promise<string>;
  /** `bytes` random bytes as lowercase hex. */
  randomHex(bytes: number): string;
  readonly self: { readonly pid: number; readonly startMs: number | null };
  sleep(ms: number): Promise<void>;
  /** Whether the process a local lock names is still running. */
  isAlive(owner: { pid: number; startMs: number | null }): Promise<boolean>;
}
