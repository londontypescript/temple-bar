// Which kind of checkout git is working in, and the warning for a main
// checkout that has left the default branch.
//
// The main checkout (the folder the repo was cloned into) stays on the
// default branch, so branch work happens in linked worktrees and parallel
// work never collides. The post-checkout hook calls this after every
// checkout there: switching it to another branch, or to a detached HEAD,
// gets a warning saying how to put it back. It is only a warning: the
// checkout has already happened, and there are good reasons to look at
// another commit for a moment. Linked worktrees are on branches by design,
// so they never warn.

import path from "node:path";

import type { Context } from "../context.ts";
import { findProtectedBranch } from "./protected-branch.ts";

export interface Checkout {
  /** The checkout's top folder, as git spells it. */
  readonly worktree: string;
  /** True for a linked worktree (`git worktree add`), false for the main
   * checkout. */
  readonly linked: boolean;
}

/** git prints some paths relative to `cwd`. Joined rather than resolved:
 * path.resolve would put the current drive in front of an already absolute
 * path on Windows. */
function absolute(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}

async function gitPath(
  ctx: Context,
  flag: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", flag], ctx.cwd);
  if (result.code !== 0) {
    return undefined;
  }
  return absolute(ctx.cwd, result.stdout.trim());
}

/**
 * The checkout at `ctx.cwd`, or undefined outside a work tree. A linked
 * worktree has a git folder of its own inside the shared one; the main
 * checkout's git folder is the shared one.
 */
export async function findCheckout(
  ctx: Context,
): Promise<Checkout | undefined> {
  const gitDir = await gitPath(ctx, "--git-dir");
  const commonDir = await gitPath(ctx, "--git-common-dir");
  const worktree = await gitPath(ctx, "--show-toplevel");
  if (
    gitDir === undefined ||
    commonDir === undefined ||
    worktree === undefined
  ) {
    return undefined;
  }
  return {
    worktree,
    linked: path.normalize(gitDir) !== path.normalize(commonDir),
  };
}

/** The branch HEAD names, or undefined for a detached HEAD. */
async function currentBranch(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ctx.cwd,
  );
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * Prints a warning on stderr when `checkout` is the main checkout and it is
 * not on the default branch. Never fails: whatever it finds, the caller
 * carries on.
 */
export async function warnIfMainCheckoutOffDefault(
  ctx: Context,
  checkout: Checkout,
): Promise<void> {
  if (checkout.linked) {
    return;
  }
  const defaultBranch = await findProtectedBranch(ctx, ctx.cwd);
  const branch = await currentBranch(ctx);
  if (branch === defaultBranch) {
    return;
  }
  const where =
    branch === undefined ? "a detached HEAD" : `the branch ${branch}`;
  ctx.stderr.write(
    `temple-bar: warning: the main checkout at ${checkout.worktree} is on ${where}, not ${defaultBranch}.\n` +
      `Keep it on ${defaultBranch} and do branch work in a worktree, so parallel work never collides:\n` +
      `  git switch ${defaultBranch}\n` +
      `  git worktree add <folder> <branch>\n`,
  );
}
