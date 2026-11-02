// The one place that decides what merged pull requests left behind and
// whether `--remove` may delete it: worktrees, local branches and origin's
// branches. The report prints these verdicts, and `--remove` acts on them.

import type { Context } from "../context.ts";
import {
  finished,
  judgePullRequest,
  verdict,
  type Verdict,
} from "./finished.ts";
import { undecodable } from "./paths.ts";
import type { PullRequestFacts, Repo } from "./repository.ts";
import { judgeWorktree, type WorktreeItem } from "./worktree-verdict.ts";

export interface BranchItem {
  readonly name: string;
  readonly tip: string;
  readonly pullRequest: PullRequestFacts | undefined;
  readonly verdict: Verdict;
}

export interface Classification {
  readonly repo: Repo;
  readonly worktrees: readonly WorktreeItem[];
  readonly localBranches: readonly BranchItem[];
  readonly remoteBranches: readonly BranchItem[];
  /** What couldn't be checked, so a short report isn't read as clean. */
  readonly unchecked: readonly string[];
}

const HEADS = "refs/heads/";

/** A local branch goes only once it is finished, isn't the default
 * branch or a symbolic ref, and no worktree holds it, unless that worktree
 * goes too. */
async function judgeLocalBranches(
  ctx: Context,
  repo: Repo,
  worktrees: readonly WorktreeItem[],
): Promise<BranchItem[]> {
  const items: BranchItem[] = [];
  const refs = [...(repo.localRefs ?? [])].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [ref, local] of refs) {
    const state = await finished(ctx, repo, ref, local.tip);
    if (state.kind === "unreported") {
      continue;
    }
    const name = ref.slice(HEADS.length);
    const reasons = [...state.reasons];
    if (reasons.length === 0) {
      reasons.push(...repo.blockers);
      if (local.symref !== "") {
        reasons.push(`it is a symbolic ref to ${local.symref}`);
      }
      if (name === repo.defaultBranch) {
        reasons.push("it is the default branch");
      }
      if (undecodable(name)) {
        reasons.push("its name isn't valid UTF-8");
      }
      const holder = repo.worktrees.find(
        (worktree) => worktree.branchRef === ref,
      );
      const going = worktrees.find(
        (item) => item.worktree === holder && item.verdict.remove,
      );
      if (holder?.primary === true) {
        reasons.push("it is checked out in the primary checkout");
      } else if (holder !== undefined && going === undefined) {
        reasons.push(`it is checked out in ${holder.path}, which is kept`);
      }
    }
    items.push({
      name,
      tip: local.tip,
      pullRequest: state.pullRequest,
      verdict: verdict(reasons),
    });
  }
  return items;
}

/** origin's branch goes only while its tip is exactly the merged head:
 * one behind or beyond it is reported, since the lease would refuse it. */
function judgeRemoteBranches(repo: Repo): BranchItem[] {
  const items: BranchItem[] = [];
  const refs = [...(repo.remoteRefs ?? [])].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [ref, tip] of refs) {
    const name = ref.slice(HEADS.length);
    const state = judgePullRequest(repo, ref);
    if (name === repo.defaultBranch || state.kind === "unreported") {
      continue;
    }
    const { pullRequest } = state;
    const reasons = [...state.reasons];
    if (pullRequest?.state === "MERGED" && reasons.length === 0) {
      if (tip !== pullRequest.head) {
        reasons.push(
          `its tip ${tip} isn't pull request #${String(pullRequest.number)}'s head ${pullRequest.head}`,
        );
      }
      reasons.push(...repo.blockers);
      if (undecodable(name)) {
        reasons.push("its name isn't valid UTF-8");
      }
    }
    items.push({ name, tip, pullRequest, verdict: verdict(reasons) });
  }
  return items;
}

export async function classify(
  ctx: Context,
  repo: Repo,
): Promise<Classification> {
  const unchecked: string[] = [];
  if (repo.pullRequests === undefined) {
    unchecked.push("branches' pull requests (gh couldn't list them)");
  }
  if (repo.localRefs === undefined) {
    unchecked.push(
      "local branches (git couldn't list them), so no worktree or local branch is removed",
    );
  }
  if (repo.remoteRefs === undefined) {
    unchecked.push("remote branches (couldn't read origin)");
  }
  const worktrees: WorktreeItem[] = [];
  for (const worktree of repo.worktrees) {
    const item = await judgeWorktree(ctx, repo, worktree, undefined);
    if (item !== undefined) {
      worktrees.push(item);
    }
  }
  return {
    repo,
    worktrees,
    localBranches: await judgeLocalBranches(ctx, repo, worktrees),
    remoteBranches: judgeRemoteBranches(repo),
    unchecked,
  };
}
