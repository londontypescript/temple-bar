// Shared child-process runner used by the git and gh seams (src/seams/git.ts,
// src/seams/gh.ts). Both need the same "never throw, tell a spawn failure
// apart from a non-zero exit" behaviour, so it lives once here instead of
// being duplicated in each seam.

import { execFile } from "node:child_process";

export interface ExecOutcome {
  /** Process exit code, or null when the process could not be started. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the executable itself could not be found on PATH. */
  readonly notFound: boolean;
}

export interface ExecOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

/**
 * Runs `command` with `args`, resolving instead of rejecting on any outcome:
 * a clean exit, a non-zero exit, or a failure to spawn the executable at all
 * (for example because it isn't installed). Callers that care about a
 * missing executable distinctly (the gh seam) read `notFound`.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: ExecOptions,
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        // The 1 MiB default would turn a long `git log` into a failure.
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, notFound: false });
          return;
        }

        const errno = isErrnoException(error) ? error.code : undefined;
        if (typeof errno === "number") {
          resolve({ code: errno, stdout, stderr, notFound: false });
          return;
        }

        // A string `code` here (ENOENT, EACCES, ...) means the process never
        // started, so there is no meaningful exit code.
        resolve({
          code: null,
          stdout,
          stderr,
          notFound: errno === "ENOENT",
        });
      },
    );
  });
}
