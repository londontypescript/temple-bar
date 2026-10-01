// Logic behind `temple-bar hook pre-commit`. Refuses a commit while the
// protected branch (protected-branch.ts: the repo's default branch) is
// checked out, including an unborn one (a repo with no commits yet), since
// `git symbolic-ref` resolves HEAD's branch name regardless of whether it
// points at a real commit.
//
// This is the early, friendly refusal. `commit --no-verify` skips it, which
// is why the reference-transaction hook refuses the same move again.

import type { Context } from "../context.ts";
import { findProtectedBranch } from "./protected-branch.ts";

async function currentBranch(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ctx.cwd,
  );
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * `temple-bar hook pre-commit`: exit 1 (and print the refusal) when the
 * current branch is the protected one. A detached HEAD (symbolic-ref fails)
 * is on no branch, so it's allowed here.
 */
export async function preCommitCheck(ctx: Context): Promise<number> {
  const branch = await currentBranch(ctx);
  if (branch === undefined) {
    return 0;
  }
  const protectedBranch = await findProtectedBranch(ctx, ctx.cwd);
  if (branch === protectedBranch) {
    ctx.stderr.write(
      `temple-bar: refusing to commit directly to ${protectedBranch}. Create a branch first: git switch -c <name>\n`,
    );
    return 1;
  }
  return 0;
}
