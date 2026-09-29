// Logic behind `temple-bar hook pre-commit`. Refuses a commit while `main`
// is the checked-out branch, including an unborn `main` (a repo with no
// commits yet), since `git symbolic-ref` resolves HEAD's branch name
// regardless of whether it points at a real commit.

import type { Context } from "../context.ts";

const REFUSAL_MESSAGE =
  "temple-bar: refusing to commit directly to main. Create a branch first: git switch -c <name>\n";

async function currentBranch(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ctx.cwd,
  );
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * `temple-bar hook pre-commit`: exit 1 (and print the refusal) when the
 * current branch is `main`. A detached HEAD (symbolic-ref fails) is not
 * `main`, so it's allowed here; that case isn't a target of this check.
 */
export async function preCommitCheck(ctx: Context): Promise<number> {
  const branch = await currentBranch(ctx);
  if (branch === "main") {
    ctx.stderr.write(REFUSAL_MESSAGE);
    return 1;
  }
  return 0;
}
