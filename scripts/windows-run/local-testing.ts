// A real git repo for the local-side tests, committing as a known identity.

import { execFileSync } from "node:child_process";

export function configureTestRepoForScripts(dir: string): void {
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
}
