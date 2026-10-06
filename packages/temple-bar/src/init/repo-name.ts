// Setup uses the same repository name for packages and GitHub suggestions,
// even when a harness runs it in a worktree with an unrelated folder name.

import path from "node:path";

import type { Context } from "../context.ts";
import { findCommonGitDir } from "../git-common-dir.ts";
import { checkOrigin } from "./requirements.ts";

/**
 * The name of the main checkout's folder: the parent of git's common
 * directory, so a worktree such as `.claude/worktrees/setup` still gives the
 * repo's own folder name. Falls back to this folder's name when git can't
 * tell, or when the main repository is bare (its parent is not a checkout).
 */
export async function mainCheckoutName(
  ctx: Context,
  repoRoot: string,
): Promise<string> {
  const fallback = repoRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? "app";
  const commonDir = await findCommonGitDir(ctx, repoRoot);
  if (commonDir === undefined || path.basename(commonDir) !== ".git") {
    return fallback;
  }
  // Asked of the common directory, not of this folder: a worktree of a bare
  // repository is itself not bare.
  const bare = await ctx.git.run(
    ["--git-dir", commonDir, "rev-parse", "--is-bare-repository"],
    repoRoot,
  );
  if (bare.code !== 0 || bare.stdout.trim() === "true") {
    return fallback;
  }
  return path.basename(path.dirname(commonDir)) || fallback;
}

/** The name a new package gets: the GitHub repository's name from `origin`
 * when there is one, otherwise the main checkout's folder. */
export async function repoName(
  ctx: Context,
  repoRoot: string,
): Promise<string> {
  const origin = await checkOrigin(ctx, repoRoot);
  return origin.state === "ok"
    ? origin.origin.repo
    : mainCheckoutName(ctx, repoRoot);
}
