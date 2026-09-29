// A real git repo for end-to-end tests. Excluded from the built package
// (tsconfig.build.json).

import { execFileSync } from "node:child_process";

/** Initialise `dir` as a repo on `main` that commits the same way on every
 * machine. Everything a commit reads from config is set locally, so the
 * developer's global config can't leak in: a global `commit.gpgsign=true`
 * would otherwise make `git commit` wait on a pinentry prompt and fail in any
 * headless run. */
export function initTestRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}
