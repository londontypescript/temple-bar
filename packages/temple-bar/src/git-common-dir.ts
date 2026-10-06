// Finds the git folder every worktree of a repo shares. Hooks install there,
// and setup reads the main checkout's folder from it.

import path from "node:path";

import type { Context } from "./context.ts";

/** The git folder every worktree of this repo shares, as an absolute path. */
export async function findCommonGitDir(
  ctx: Context,
  repoRoot: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", "--git-common-dir"], repoRoot);
  if (result.code !== 0) {
    return undefined;
  }
  // Relative to repoRoot when it is the main worktree (".git"). Joined, not
  // resolved: path.resolve would put the current drive in front of an
  // already absolute path on Windows.
  const dir = result.stdout.trim();
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}
