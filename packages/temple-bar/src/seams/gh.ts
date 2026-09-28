// The only place that shells out to the `gh` CLI. Kept separate from the git
// seam (src/seams/git.ts) because callers (1.7's `init`) need to tell "gh
// isn't installed" apart from "gh exited non-zero" to print the exact fix.

import { runCommand } from "./exec.ts";

export interface GhResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the `gh` executable itself could not be found on PATH. */
  readonly notFound: boolean;
}

export interface GhSeam {
  /** Runs `gh <args>` in `cwd`. Never throws, including on a non-zero exit. */
  run(args: readonly string[], cwd: string): Promise<GhResult>;
}

export function createGhSeam(env: NodeJS.ProcessEnv = process.env): GhSeam {
  return {
    async run(args, cwd) {
      const outcome = await runCommand("gh", args, { cwd, env });
      return {
        code: outcome.code,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        notFound: outcome.notFound,
      };
    },
  };
}
