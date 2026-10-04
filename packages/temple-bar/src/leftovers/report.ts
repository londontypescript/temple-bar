// Finds what a finished piece of work can leave behind: local and remote
// branches whose pull request already merged or closed, worktrees on those
// branches, and worktrees whose branch or folder is gone. It only reports;
// deleting is left to a person who can see whether anything there is worth
// keeping.

import type { Context } from "../context.ts";
import { findProtectedBranch } from "../hooks/protected-branch.ts";
import { listWorktrees } from "../merge/worktrees.ts";

interface ClosedPullRequest {
  readonly number: number;
  readonly state: "MERGED" | "CLOSED";
}

interface Leftovers {
  readonly localBranches: { branch: string; pullRequest: ClosedPullRequest }[];
  readonly remoteBranches: { branch: string; pullRequest: ClosedPullRequest }[];
  readonly worktrees: { path: string; reason: string }[];
  /** What couldn't be checked, so a short report isn't mistaken for a
   * clean one. */
  readonly unchecked: string[];
}

interface PullRequest {
  readonly number: number;
  readonly state: string;
  /** The last commit the pull request held. */
  readonly head: string;
}

/** Each branch's most recent pull request; gh lists newest first. Open ones
 * are kept too, so a branch reused for new work isn't reported. */
async function latestPullRequests(
  ctx: Context,
  cwd: string,
): Promise<Map<string, PullRequest> | undefined> {
  const result = await ctx.gh.run(
    [
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,headRefName,headRefOid,state",
    ],
    cwd,
  );
  if (result.code !== 0) {
    return undefined;
  }
  const latest = new Map<string, PullRequest>();
  try {
    const list = JSON.parse(result.stdout) as Record<string, unknown>[];
    for (const item of list) {
      const branch =
        typeof item.headRefName === "string" ? item.headRefName : "";
      const number = typeof item.number === "number" ? item.number : 0;
      const head = typeof item.headRefOid === "string" ? item.headRefOid : "";
      const known = latest.get(branch);
      if (branch !== "" && (known === undefined || number > known.number)) {
        latest.set(branch, { number, state: String(item.state), head });
      }
    }
  } catch {
    return undefined;
  }
  return latest;
}

/** The branch's closed pull request, but only when the branch holds nothing
 * beyond it. Branch names get reused: a new branch named like an old, merged
 * pull request's holds live work, and calling it finished would suggest
 * deleting commits that exist nowhere else. A tip that is the pull request's
 * last commit, or behind it, adds nothing. */
async function finished(
  ctx: Context,
  cwd: string,
  pullRequest: PullRequest | undefined,
  tip: string,
): Promise<ClosedPullRequest | undefined> {
  if (pullRequest?.state !== "MERGED" && pullRequest?.state !== "CLOSED") {
    return undefined;
  }
  if (pullRequest.head === "" || tip === "") {
    return undefined;
  }
  const holdsNothingMore =
    tip === pullRequest.head ||
    (
      await ctx.git.run(
        ["merge-base", "--is-ancestor", tip, pullRequest.head],
        cwd,
      )
    ).code === 0;
  return holdsNothingMore
    ? { number: pullRequest.number, state: pullRequest.state }
    : undefined;
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

async function findLeftovers(ctx: Context, cwd: string): Promise<Leftovers> {
  const leftovers: Leftovers = {
    localBranches: [],
    remoteBranches: [],
    worktrees: [],
    unchecked: [],
  };
  const defaultBranch = await findProtectedBranch(ctx, cwd);
  const pullRequests = await latestPullRequests(ctx, cwd);
  if (pullRequests === undefined) {
    leftovers.unchecked.push("branches' pull requests (gh couldn't list them)");
  }

  const local = await ctx.git.run(
    ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/"],
    cwd,
  );
  // Branch names can't contain spaces, so the first one splits name from tip.
  const localTips = new Map(
    lines(local.stdout).map((line) => {
      const [branch = "", tip = ""] = line.split(" ");
      return [branch, tip] as const;
    }),
  );
  const finishedLocal = new Map<string, ClosedPullRequest>();
  for (const branch of [...localTips.keys()].sort()) {
    const pullRequest = await finished(
      ctx,
      cwd,
      pullRequests?.get(branch),
      localTips.get(branch) ?? "",
    );
    if (branch !== defaultBranch && pullRequest !== undefined) {
      finishedLocal.set(branch, pullRequest);
      leftovers.localBranches.push({ branch, pullRequest });
    }
  }

  const remote = await ctx.git.run(["ls-remote", "--heads", "origin"], cwd);
  if (remote.code === 0) {
    for (const line of lines(remote.stdout)) {
      const [tip = "", ref = ""] = line.split(/\s+/);
      const branch = ref.replace(/^refs\/heads\//, "");
      const pullRequest = await finished(
        ctx,
        cwd,
        pullRequests?.get(branch),
        tip,
      );
      if (
        branch !== "" &&
        branch !== defaultBranch &&
        pullRequest !== undefined
      ) {
        leftovers.remoteBranches.push({ branch, pullRequest });
      }
    }
  } else {
    leftovers.unchecked.push("remote branches (couldn't reach origin)");
  }

  for (const worktree of await listWorktrees(ctx, cwd)) {
    if (worktree.primary) {
      continue;
    }
    const pullRequest =
      worktree.branch === undefined
        ? undefined
        : finishedLocal.get(worktree.branch);
    if (worktree.prunable) {
      leftovers.worktrees.push({
        path: worktree.path,
        reason: "its folder is gone",
      });
    } else if (
      worktree.branch !== undefined &&
      !localTips.has(worktree.branch)
    ) {
      leftovers.worktrees.push({
        path: worktree.path,
        reason: `its branch ${worktree.branch} no longer exists`,
      });
    } else if (worktree.branch !== undefined && pullRequest !== undefined) {
      leftovers.worktrees.push({
        path: worktree.path,
        reason: `its branch ${worktree.branch}'s pull request #${String(pullRequest.number)} is ${pullRequest.state.toLowerCase()}`,
      });
    }
  }
  return leftovers;
}

function describe(pullRequest: ClosedPullRequest): string {
  return `pull request #${String(pullRequest.number)} ${pullRequest.state.toLowerCase()}`;
}

/** The report, one line per leftover with the command that would remove
 * it, for a person to run after checking. */
function formatLeftovers(leftovers: Leftovers, prefix: string): string {
  const out: string[] = [];
  for (const { path, reason } of leftovers.worktrees) {
    out.push(`worktree ${path}: ${reason} (git worktree remove ${path})`);
  }
  for (const { branch, pullRequest } of leftovers.localBranches) {
    out.push(
      `local branch ${branch}: ${describe(pullRequest)} (git branch -D ${branch})`,
    );
  }
  for (const { branch, pullRequest } of leftovers.remoteBranches) {
    out.push(
      `remote branch origin/${branch}: ${describe(pullRequest)} (git push origin --delete ${branch})`,
    );
  }
  const text: string[] =
    out.length === 0
      ? [`${prefix}no leftover branches or worktrees`]
      : [
          `${prefix}${String(out.length)} left behind (nothing deleted; check each before removing it):`,
          ...out.map((line) => `${prefix}  ${line}`),
        ];
  for (const what of leftovers.unchecked) {
    text.push(`${prefix}not checked: ${what}`);
  }
  return `${text.join("\n")}\n`;
}

/** Finds and prints the leftovers; returns how many there are. */
export async function reportLeftovers(
  ctx: Context,
  cwd: string,
  prefix: string,
): Promise<number> {
  const leftovers = await findLeftovers(ctx, cwd);
  ctx.stdout.write(formatLeftovers(leftovers, prefix));
  return (
    leftovers.worktrees.length +
    leftovers.localBranches.length +
    leftovers.remoteBranches.length
  );
}
