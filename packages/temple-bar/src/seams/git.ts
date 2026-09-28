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
  /** Runs `git <args>` in `cwd`. Never throws, including on a non-zero exit. */
  run(args: readonly string[], cwd: string): Promise<GitResult>;
}

export function createGitSeam(env: NodeJS.ProcessEnv = process.env): GitSeam {
  return {
    async run(args, cwd) {
      const outcome = await runCommand("git", args, { cwd, env });
      return {
        code: outcome.code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
      };
    },
  };
}
