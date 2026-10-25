// Whether this branch is behind origin's default branch, checked by `ready`
// before the gate runs. GitHub's ruleset merges only branches that are up to
// date, so a behind branch can't merge whatever its checks say: pushing it
// would spend a full CI run for nothing. Better to say so here, before the
// long gate run, and let the author merge the default branch in first.
//
// The local remote-tracking ref can be days old, which would hide the gap,
// so `ready` fetches the default branch first. It fetches that one branch
// only, with no tags, and stops if the fetch fails: carrying on would let
// through exactly the wasted run this check is for.
//
// Only `ready` fetches. The pre-push hook shares other parts of ready's
// logic, but a push makes no extra network call.

import type { Context } from "../context.ts";
import {
  findProtectedBranch,
  upstreamRefFor,
} from "../hooks/protected-branch.ts";

/** Fetches origin's default branch and returns why `head` can't be marked
 * because of where it stands against it, or undefined when it is up to
 * date. */
export async function behindDefaultBranch(
  ctx: Context,
  root: string,
  head: string,
): Promise<string | undefined> {
  // The same rule the hooks use: origin/HEAD, else main. A fetch doesn't
  // set origin/HEAD, so there is no better answer to be had from it.
  const branch = await findProtectedBranch(ctx, root);
  const upstream = upstreamRefFor(branch);
  // The explicit refspec updates the remote-tracking ref whatever refspec
  // the clone is configured with. The empty refmap stops git also applying
  // the configured fetch refspecs to what it fetched, which could move some
  // other ref that maps the same branch, so this touches no other ref.
  const fetched = await ctx.git.run(
    [
      "fetch",
      "--quiet",
      "--no-tags",
      "--refmap=",
      "origin",
      `+refs/heads/${branch}:${upstream}`,
    ],
    root,
  );
  if (fetched.code !== 0) {
    return (
      `could not fetch ${branch} from origin, so ready can't tell whether this branch is behind it:\n` +
      `${fetched.stderr.trim() || `git fetch exited with ${String(fetched.code)}`}\n` +
      "Fix the fetch and run ready again. If " +
      `${branch} isn't the default branch, \`git remote set-head origin --auto\` records which one is.`
    );
  }
  const counted = await ctx.git.run(
    ["rev-list", "--count", `${head}..${upstream}`],
    root,
  );
  const count = counted.stdout.trim();
  if (counted.code !== 0 || !/^\d+$/.test(count)) {
    return (
      `could not count how far this branch is behind origin/${branch}, so it is not marked: ` +
      (counted.stderr.trim() || `git rev-list printed "${count}"`)
    );
  }
  const behind = Number(count);
  if (behind === 0) {
    return undefined;
  }
  const commits = behind === 1 ? "1 commit" : `${String(behind)} commits`;
  return (
    `this branch is ${commits} behind origin/${branch}: ` +
    `merge it in (git merge origin/${branch}), then run ready again.`
  );
}
