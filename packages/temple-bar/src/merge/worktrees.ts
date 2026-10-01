// Reads `git worktree list --porcelain`: which folder has which branch
// checked out. Both `temple-bar merge` (to find the worktree to update and
// later remove) and `temple-bar leftovers` (to find worktrees left behind)
// need the same answer, so it is parsed once, here.

import type { Context } from "../context.ts";

export interface Worktree {
  readonly path: string;
  /** Short branch name, or undefined when detached or bare. */
  readonly branch: string | undefined;
  readonly head: string | undefined;
  /** The first entry git lists: the original clone, never removed. */
  readonly primary: boolean;
  /** git says the folder is gone, so `git worktree prune` would drop it. */
  readonly prunable: boolean;
}

const BRANCH_PREFIX = "refs/heads/";

/** Parses the porcelain format: blocks of "key value" lines, one block per
 * worktree, separated by a blank line. */
export function parseWorktreeList(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];
  const blocks = porcelain.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    let path: string | undefined;
    let branch: string | undefined;
    let head: string | undefined;
    let prunable = false;
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(" ");
      const key = space === -1 ? line : line.slice(0, space);
      const value = space === -1 ? "" : line.slice(space + 1);
      if (key === "worktree") {
        path = value;
      } else if (key === "HEAD") {
        head = value;
      } else if (key === "branch") {
        branch = value.startsWith(BRANCH_PREFIX)
          ? value.slice(BRANCH_PREFIX.length)
          : value;
      } else if (key === "prunable") {
        prunable = true;
      }
    }
    if (path !== undefined) {
      worktrees.push({
        path,
        branch,
        head,
        primary: worktrees.length === 0,
        prunable,
      });
    }
  }
  return worktrees;
}

/** Every worktree of the repository at `cwd`; throws when git can't list
 * them, because nothing that follows is safe without this list. */
export async function listWorktrees(
  ctx: Context,
  cwd: string,
): Promise<Worktree[]> {
  const result = await ctx.git.run(["worktree", "list", "--porcelain"], cwd);
  if (result.code !== 0) {
    throw new Error(
      `could not list git worktrees: ${result.stderr.trim() || "git failed"}`,
    );
  }
  return parseWorktreeList(result.stdout);
}

/** True when `git status` shows anything: staged, unstaged or untracked. */
export async function isDirty(ctx: Context, cwd: string): Promise<boolean> {
  const result = await ctx.git.run(["status", "--porcelain"], cwd);
  return result.code !== 0 || result.stdout.trim() !== "";
}
