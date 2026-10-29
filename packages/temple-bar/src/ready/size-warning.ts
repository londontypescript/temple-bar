// After a passing gate, `ready` measures the branch against the pull request
// size limits and warns when it is over any of them. `merge` refuses an
// oversized pull request without a `One concern:` line, and CI warns only
// after the push; `ready` runs many times while the work is still under way,
// so a warning here reaches the author while splitting is still cheap.
//
// It is advice, never a refusal: the size never changes whether the commit
// is marked or what `ready` exits with. That includes a measurement that
// fails (no origin, no default branch, no primary checkout, a git error): it
// is said, and `ready` carries on. The report and its wording are
// pr/size.ts's, the same the pre-push hook prints.
//
// It measures the way `merge` does: from origin's default branch, and in the
// primary checkout, which stays on the default branch, so the limits in
// temple-bar.config.json and the linguist-generated marks are the default
// branch's. A branch can't loosen the check that judges it, so it isn't told
// it is fine here only to be refused at merge. There is no pull request
// description to read yet, so the report asks for a `One concern:` line in
// the pull request rather than looking for one.

import type { Context } from "../context.ts";
import {
  findProtectedBranch,
  upstreamRefFor,
} from "../hooks/protected-branch.ts";
import { listWorktrees } from "../merge/worktrees.ts";
import { checkPullRequestSize, formatSizeReport } from "../pr/size.ts";

async function findPrimaryCheckout(
  ctx: Context,
  root: string,
): Promise<string> {
  const primary = (await listWorktrees(ctx, root)).find(
    (worktree) => worktree.primary,
  );
  if (primary === undefined) {
    throw new Error("git listed no primary checkout");
  }
  return primary.path;
}

/** Writes the size warning to stderr when the branch checked out at `root`,
 * with `head` at its tip, is over a size limit; writes nothing when it is
 * within them. Never throws. */
export async function warnAboutBranchSize(
  ctx: Context,
  root: string,
  head: string,
): Promise<void> {
  try {
    const branch = await findProtectedBranch(ctx, root);
    const primary = await findPrimaryCheckout(ctx, root);
    const report = await checkPullRequestSize(
      { ...ctx, cwd: primary },
      { base: upstreamRefFor(branch), head, skipPullRequestText: true },
    );
    if (report.problems.length > 0) {
      ctx.stderr.write(formatSizeReport(report));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(
      `ready: warning: could not measure this branch against the pull request size limits, so it isn't checked: ${message}\n`,
    );
  }
}
