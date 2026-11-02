// The report: what merged or closed pull requests left behind, each with
// the verdict `temple-bar leftovers --remove` would reach. It deletes
// nothing. `temple-bar merge` prints the same report after merging.

import type { Context } from "../context.ts";
import { classify, type BranchItem, type Classification } from "./classify.ts";
import { reasonsOf, type Verdict } from "./finished.ts";
import type { PullRequestFacts } from "./repository.ts";
import { readRepo } from "./repository.ts";

function describePullRequest(
  pullRequest: PullRequestFacts | undefined,
): string {
  return pullRequest === undefined
    ? "pull request unknown"
    : `pull request #${String(pullRequest.number)} ${pullRequest.state.toLowerCase()}`;
}

function describeVerdict(verdict: Verdict): string {
  return verdict.remove ? "would remove" : `kept: ${reasonsOf(verdict)}`;
}

function branchLine(label: string, item: BranchItem): string {
  return `${label} (${describePullRequest(item.pullRequest)}): ${describeVerdict(item.verdict)}`;
}

/** One line per item, then what couldn't be checked. */
function formatClassification(
  found: Classification,
  prefix: string,
  none: string,
): string {
  const out: string[] = [];
  for (const { worktree, pullRequest, verdict } of found.worktrees) {
    const what = [
      worktree.branch ?? "detached",
      ...(pullRequest === undefined ? [] : [describePullRequest(pullRequest)]),
    ].join(", ");
    out.push(
      `worktree ${worktree.path} (${what}): ${describeVerdict(verdict)}`,
    );
  }
  for (const item of found.localBranches) {
    out.push(branchLine(`local branch ${item.name}`, item));
  }
  for (const item of found.remoteBranches) {
    out.push(branchLine(`remote branch origin/${item.name}`, item));
  }
  const text: string[] =
    out.length === 0
      ? [`${prefix}${none}`]
      : [
          `${prefix}${String(out.length)} left behind (nothing deleted):`,
          ...out.map((line) => `${prefix}  ${line}`),
        ];
  for (const what of found.unchecked) {
    text.push(`${prefix}not checked: ${what}`);
  }
  const removable = [
    ...found.worktrees,
    ...found.localBranches,
    ...found.remoteBranches,
  ].some((item) => item.verdict.remove);
  if (removable) {
    text.push(
      `${prefix}\`temple-bar leftovers --remove\`, run from the primary checkout, removes what it would`,
    );
  }
  return `${text.join("\n")}\n`;
}

/** Finds and prints the leftovers; returns how many there are. */
export async function reportLeftovers(
  ctx: Context,
  cwd: string,
  prefix: string,
  /** What to say when there are none; a caller that knows of a folder git
   * no longer lists says so here rather than claim all is clean. */
  none = "no leftover branches or worktrees",
): Promise<number> {
  const found = await classify(ctx, await readRepo(ctx, cwd, { remote: true }));
  ctx.stdout.write(formatClassification(found, prefix, none));
  return (
    found.worktrees.length +
    found.localBranches.length +
    found.remoteBranches.length
  );
}
