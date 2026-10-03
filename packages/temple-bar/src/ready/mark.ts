// The "ready to push" mark: which commit `temple-bar ready` last saw pass
// the full gate in this worktree. The pre-push hook lets a branch out only
// when the commit being pushed is the marked one.
//
// Where it lives: a one-line file holding the commit's hash, inside git's
// own folder for this worktree (`git rev-parse --git-path`, which gives
// `.git/temple-bar-ready` in the main checkout and
// `.git/worktrees/<name>/temple-bar-ready` in a linked worktree). That
// place was chosen because:
//
//   - it survives between running `ready` and running `git push`, which
//     are separate processes, possibly minutes apart;
//   - every worktree has its own, so marking a commit in one worktree never
//     lets a different, unchecked commit out of another;
//   - nothing inside git's folder is ever committed or shown as a change,
//     so the mark can't leak into the repo or dirty the working tree.
//
// Any new commit clears the mark without anyone deleting it: the hook
// compares the marked hash with the commit being pushed, and a new commit
// has a new hash.

import path from "node:path";

import type { Context } from "../context.ts";

const MARK_NAME = "temple-bar-ready";

async function markPath(ctx: Context, cwd: string): Promise<string> {
  const result = await ctx.git.run(["rev-parse", "--git-path", MARK_NAME], cwd);
  if (result.code !== 0) {
    throw new Error(
      `could not find this worktree's git folder: ${result.stderr.trim() || "git rev-parse failed"}`,
    );
  }
  // git answers relative to `cwd` in the main checkout, absolute elsewhere.
  // Joined rather than resolved: on Windows, resolving adds the current
  // drive to a path that has none, which names the same file on disk but
  // not the same string.
  const answer = result.stdout.trim();
  return path.isAbsolute(answer) ? answer : path.join(cwd, answer);
}

/** The commit marked ready in the worktree at `cwd`, or undefined. */
export async function readMark(
  ctx: Context,
  cwd: string,
): Promise<string | undefined> {
  const text = await ctx.fs.readText(await markPath(ctx, cwd));
  const sha = text?.trim() ?? "";
  return sha === "" ? undefined : sha;
}

export async function writeMark(
  ctx: Context,
  cwd: string,
  sha: string,
): Promise<void> {
  await ctx.fs.writeText(await markPath(ctx, cwd), `${sha}\n`);
}

/** Empties the mark. The filesystem seam has no delete, and an empty mark
 * marks nothing, which is all that matters to the hook. */
export async function clearMark(ctx: Context, cwd: string): Promise<void> {
  await ctx.fs.writeText(await markPath(ctx, cwd), "");
}
