// Setup uses the same repository name for packages and GitHub suggestions,
// even when a harness runs it in a worktree with an unrelated folder name.

import path from "node:path";

import type { Context } from "../context.ts";
import { checkOrigin } from "./requirements.ts";

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

export async function repoName(
  ctx: Context,
  repoRoot: string,
): Promise<string> {
  const origin = await checkOrigin(ctx, repoRoot);
  if (origin.state === "ok") {
    return origin.origin.repo;
  }

  const fallback = repoRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? "app";
  const commonDir = await findCommonGitDir(ctx, repoRoot);
  if (commonDir === undefined || path.basename(commonDir) !== ".git") {
    return fallback;
  }
  // A bare repository's parent isn't a checkout, even if it is named .git.
  const bare = await ctx.git.run(
    ["rev-parse", "--is-bare-repository"],
    repoRoot,
  );
  if (bare.code !== 0 || bare.stdout.trim() === "true") {
    return fallback;
  }
  return path.basename(path.dirname(commonDir)) || fallback;
}
