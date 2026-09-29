// A real git repo for end-to-end tests. Excluded from the built package
// (tsconfig.build.json).

import { execFileSync } from "node:child_process";

/** Make `dir` (an existing repo or clone) commit as a known identity.
 *
 * Signing and every other machine-level setting are not handled here: the
 * suite runs with `GIT_CONFIG_GLOBAL` pointing at an empty file and
 * `GIT_CONFIG_NOSYSTEM=1` (scripts/isolate-git-config.ts, loaded by `pnpm test`). A
 * run without that isolation fails here at once, instead of hanging later on
 * a signing prompt. */
export function configureTestRepo(dir: string): void {
  if (process.env.GIT_CONFIG_NOSYSTEM !== "1") {
    throw new Error(
      "git config is not isolated: run the suite with `pnpm test` (node --import ./scripts/isolate-git-config.ts --test)",
    );
  }
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
}

/** Initialise `dir` as a repo on `main`, configured by configureTestRepo. */
export function initTestRepo(dir: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir });
  configureTestRepo(dir);
}
