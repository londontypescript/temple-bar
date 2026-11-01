// Whether a branch's work is finished: the one rule behind every verdict on
// a worktree, a local branch and a remote branch.

import type { Context } from "../context.ts";
import type { PullRequestFacts, Repo } from "./repository.ts";

export type Verdict =
  | { readonly remove: true }
  | { readonly remove: false; readonly reasons: readonly string[] };

export function verdict(reasons: readonly string[]): Verdict {
  return reasons.length === 0 ? { remove: true } : { remove: false, reasons };
}

/** Why it is kept, as one line; empty when it would be removed. */
export function reasonsOf(verdict: Verdict): string {
  return verdict.remove ? "" : verdict.reasons.join("; ");
}

export type Finished =
  | { readonly kind: "unreported" }
  | {
      readonly kind: "judged";
      readonly pullRequest: PullRequestFacts | undefined;
      /** Why the branch isn't finished; empty when it is. */
      readonly reasons: string[];
    };

/** Whether a local branch at `tip` is finished: its newest pull request
 * merged into the default branch from this repository, and the branch
 * holds nothing beyond its head. An open pull request, or none, is live
 * work and isn't reported. Ancestry is read with replacement objects off,
 * so a replacement ref can't fake it. */
export async function finished(
  ctx: Context,
  repo: Repo,
  ref: string,
  tip: string,
): Promise<Finished> {
  const newest = repo.pullRequests?.get(ref);
  if (newest === undefined) {
    return { kind: "unreported" };
  }
  if (newest.kind === "unknown") {
    return {
      kind: "judged",
      pullRequest: undefined,
      reasons: ["its newest pull request can't be read"],
    };
  }
  const pullRequest = newest.pullRequest;
  const label = `pull request #${String(pullRequest.number)}`;
  if (pullRequest.state === "OPEN") {
    return { kind: "unreported" };
  }
  if (pullRequest.state === "CLOSED") {
    return {
      kind: "judged",
      pullRequest,
      reasons: [`${label} closed without merging`],
    };
  }
  const reasons: string[] = [];
  if (pullRequest.crossRepository) {
    reasons.push(`${label} came from a fork`);
  }
  if (pullRequest.base !== repo.defaultBranch) {
    reasons.push(
      `${label} merged into ${pullRequest.base}, not the default branch`,
    );
  }
  if (tip !== pullRequest.head) {
    const ancestor = await ctx.git.run(
      [
        "--no-replace-objects",
        "merge-base",
        "--is-ancestor",
        tip,
        pullRequest.head,
      ],
      repo.primary.path,
    );
    if (ancestor.code === 1) {
      reasons.push(`it holds commits beyond ${label}'s head`);
    } else if (ancestor.code !== 0) {
      reasons.push(
        `can't tell whether it holds commits beyond ${label}'s head`,
      );
    }
  }
  return { kind: "judged", pullRequest, reasons };
}
