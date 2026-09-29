// A real git repo for end-to-end tests. Excluded from the built package
// (tsconfig.build.json).

import { execFileSync } from "node:child_process";

/** Make `dir` (an existing repo or clone) commit the same way on every
 * machine. Everything a commit reads from config is set locally, so the
 * developer's global config can't leak in: a global `commit.gpgsign=true`
 * would otherwise make `git commit` wait on a pinentry prompt and fail in any
 * headless run. */
export function configureTestRepo(dir: string): void {
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}

/** Initialise `dir` as a repo on `main`, configured by configureTestRepo. */
export function initTestRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  configureTestRepo(dir);
}
