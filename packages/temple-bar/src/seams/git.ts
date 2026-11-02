// The only place that shells out to `git`. Domain code never imports
// node:child_process directly, so tests can fake this seam instead of
// touching a real repository.

import { runCommand } from "./exec.ts";

export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitSeam {
  /** Runs `git <args>` in `cwd`, writing `input` to its stdin when given
   * (for `update-ref --stdin` and `hash-object --stdin`). Never throws,
   * including on a non-zero exit. */
  run(args: readonly string[], cwd: string, input?: string): Promise<GitResult>;
}

export function createGitSeam(env: NodeJS.ProcessEnv = process.env): GitSeam {
  return {
    async run(args, cwd, input) {
      const outcome = await runCommand(
        "git",
        args,
        input === undefined ? { cwd, env } : { cwd, env, input },
      );
      return {
        code: outcome.code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      };
    },
  };
}
