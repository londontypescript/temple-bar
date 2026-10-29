// After a passing gate, `ready` measures the branch against the pull request
// size limits and warns when it is over any of them. `merge` refuses an
// oversized pull request without a `One concern:` line, and CI warns only
// after the push; `ready` runs many times while the work is still under way,
// so a warning here reaches the author while splitting is still cheap.
//
// It is advice, never a refusal: the size never changes whether the commit
// is marked or what `ready` exits with. That includes a measurement that
// fails (no origin, no default branch, a git error): it is said, and `ready`
// carries on. The report and its wording are pr/size.ts's, the same the
// pre-push hook prints, measured from origin's default branch as `merge`
// does. There is no pull request description to read yet, so the report
// asks for a `One concern:` line in the pull request rather than finding one.

import type { Context } from "../context.ts";
import {
  findProtectedBranch,
  upstreamRefFor,
} from "../hooks/protected-branch.ts";
import { checkPullRequestSize, formatSizeReport } from "../pr/size.ts";

/** Writes the size warning to stderr when the branch checked out at `root`,
 * with `head` at its tip, is over a size limit; writes nothing when it is
 * within them. Never throws. */
export async function warnAboutBranchSize(
  ctx: Context,
  root: string,
  head: string,
): Promise<void> {
  // Limits and generated-file marks are read from the worktree being judged.
  const rootCtx: Context = { ...ctx, cwd: root };
  try {
    const branch = await findProtectedBranch(rootCtx, root);
    const report = await checkPullRequestSize(rootCtx, {
      base: upstreamRefFor(branch),
      head,
      skipPullRequestText: true,
    });
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
