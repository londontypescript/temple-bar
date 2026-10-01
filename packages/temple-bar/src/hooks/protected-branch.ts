// Which branch the hooks protect: the repo's default branch as GitHub reports
// it. `git clone` records that as the symbolic ref `refs/remotes/origin/HEAD`
// (pointing at, say, `refs/remotes/origin/master`), and `git remote set-head
// origin --auto` refreshes it. Before there is a remote, or on a git that
// didn't record it, the hooks fall back to `main`.
//
// The reference-transaction shim (shims.ts) repeats this rule in POSIX sh so
// it can let ordinary ref updates through without starting Node. Change both
// together.

import type { Context } from "../context.ts";

/** Protected when origin's default branch isn't known. */
export const FALLBACK_BRANCH = "main";

const ORIGIN_HEAD_REF = "refs/remotes/origin/HEAD";
const ORIGIN_PREFIX = "refs/remotes/origin/";

/**
 * Turns the target of `refs/remotes/origin/HEAD` into a branch name, or the
 * fallback when there is no target or it doesn't point into origin's
 * remote-tracking refs.
 */
export function branchFromOriginHead(target: string | undefined): string {
  const trimmed = target?.trim() ?? "";
  if (trimmed.startsWith(ORIGIN_PREFIX)) {
    const branch = trimmed.slice(ORIGIN_PREFIX.length);
    if (branch !== "" && branch !== "HEAD") {
      return branch;
    }
  }
  return FALLBACK_BRANCH;
}

/** The branch the hooks protect in the repository at `cwd`. */
export async function findProtectedBranch(
  ctx: Context,
  cwd: string,
): Promise<string> {
  const result = await ctx.git.run(
    ["symbolic-ref", "--quiet", ORIGIN_HEAD_REF],
    cwd,
  );
  return branchFromOriginHead(result.code === 0 ? result.stdout : undefined);
}

/** origin's remote-tracking ref for `branch`: what GitHub last said it was. */
export function upstreamRefFor(branch: string): string {
  return `${ORIGIN_PREFIX}${branch}`;
}
