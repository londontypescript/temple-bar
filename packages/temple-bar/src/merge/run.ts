// The whole merge of one pull request, start to finish, blocking until it
// is done so it works under any harness, including one that can't be woken
// when checks finish. Each step either passes or stops the merge with a
// refusal that says what to do; nothing is merged until every step passes.
//
// Order matters: things the author must fix (a draft, a missing bullet
// list, a change that needs the maintainer's yes) are refused before the
// long wait for checks, so nobody waits half an hour to hear about them.

import type { Context } from "../context.ts";
import { warnAboutPullRequestSize } from "../pr/size.ts";
import { reportLeftovers } from "../leftovers/report.ts";
import { reasonsForMaintainerApproval } from "./approval.ts";
import {
  countOpenIncidents,
  describeGhFailure,
  readOpenAlerts,
  readPullRequest,
  readRepository,
  readRequiredChecks,
  squashMerge,
  type Alert,
  type PullRequest,
  type Repository,
} from "./github.ts";
import {
  bringUpToDate,
  cleanUp,
  fetchOrigin,
  isAncestor,
  resolveCommit,
  worktreeForUpdate,
} from "./local.ts";
import { buildSquashMessage, readCoAuthors } from "./message.ts";
import { MergeRefusal, refuse } from "./refusal.ts";
import {
  DEFAULT_TIMING,
  waitForChecks,
  waitForHead,
  type Sleep,
  type Timing,
} from "./wait.ts";
import { listWorktrees } from "./worktrees.ts";

export interface MergeDeps {
  readonly sleep: Sleep;
  readonly timing?: Timing;
}

export interface MergeOptions {
  readonly prNumber: number;
  /** The maintainer said yes in chat to a change that needs it. */
  readonly maintainerApproved: boolean;
}

function checkMergeable(
  pullRequest: PullRequest,
  repository: Repository,
): void {
  const label = `pull request #${String(pullRequest.number)}`;
  if (pullRequest.state === "MERGED") {
    refuse(
      `${label} is already merged. \`temple-bar leftovers\` lists any branch or worktree it left behind.`,
    );
  }
  if (pullRequest.state === "CLOSED") {
    refuse(`${label} is closed. Reopen it first if it should merge.`);
  }
  if (pullRequest.isDraft) {
    refuse(
      `${label} is a draft. Mark it ready (gh pr ready ${String(pullRequest.number)}) once its work is final.`,
    );
  }
  if (pullRequest.baseRefName !== repository.defaultBranch) {
    refuse(
      `${label} targets ${pullRequest.baseRefName}, not the default branch ${repository.defaultBranch}. ` +
        "Merge only lands pull requests on the default branch.",
    );
  }
  if (pullRequest.isCrossRepository) {
    refuse(
      `${label} comes from a fork. Merge works on branches in this repository, which it can update and clean up.`,
    );
  }
}

function describeAlerts(alerts: readonly Alert[]): string {
  return alerts
    .map((alert) => `#${String(alert.number)} ${alert.rule} in ${alert.path}`)
    .join(", ");
}

async function refuseOnOpenAlerts(
  ctx: Context,
  repository: Repository,
  prNumber: number,
  cwd: string,
): Promise<void> {
  const forPullRequest = await readOpenAlerts(
    ctx,
    repository,
    { pr: prNumber },
    cwd,
  );
  const onDefault = await readOpenAlerts(
    ctx,
    repository,
    { branch: repository.defaultBranch },
    cwd,
  );
  if (forPullRequest === "not-set-up" || onDefault === "not-set-up") {
    ctx.stdout.write(
      "merge: code scanning isn't set up here, so there are no alerts to check\n",
    );
  }
  if (forPullRequest !== "not-set-up" && forPullRequest.length > 0) {
    refuse(
      `pull request #${String(prNumber)} has open code-scanning alerts: ${describeAlerts(forPullRequest)}. Fix them, push, and run merge again.`,
    );
  }
  if (onDefault !== "not-set-up" && onDefault.length > 0) {
    refuse(
      `${repository.defaultBranch} has open code-scanning alerts: ${describeAlerts(onDefault)}. Fix or dismiss them before merging more.`,
    );
  }
}

/** Brings the branch up to date with the default branch when it's behind,
 * because the ruleset only merges up-to-date branches. Returns the tip that
 * GitHub should now show as the pull request's head. */
async function upToDateTip(
  ctx: Context,
  pullRequest: PullRequest,
  repository: Repository,
  root: string,
): Promise<string> {
  const branch = pullRequest.headRefName;
  const tip = await resolveCommit(ctx, `refs/heads/${branch}`, root);
  if (tip === undefined) {
    refuse(
      `there is no local branch ${branch}. Run merge in the clone where the pull request's branch was made.`,
    );
  }
  const upstream = `origin/${repository.defaultBranch}`;
  if (await isAncestor(ctx, upstream, tip, root)) {
    return tip;
  }
  // Only a branch that matches GitHub is updated, so the push can't carry
  // commits nobody meant to push yet.
  if (tip !== pullRequest.headRefOid) {
    refuse(
      `${branch} is behind ${repository.defaultBranch}, and the local branch (${tip}) ` +
        `doesn't match the pull request's head (${pullRequest.headRefOid}). Push or pull it first.`,
    );
  }
  const worktree = await worktreeForUpdate(
    ctx,
    await listWorktrees(ctx, root),
    branch,
    `${branch} is behind ${repository.defaultBranch}`,
  );
  ctx.stdout.write(
    `merge: ${branch} is behind; merging ${upstream} into it and pushing\n`,
  );
  return bringUpToDate(ctx, worktree, branch, repository.defaultBranch);
}

async function mergeBase(
  ctx: Context,
  upstream: string,
  head: string,
  cwd: string,
): Promise<string> {
  const result = await ctx.git.run(["merge-base", upstream, head], cwd);
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== ""
    ? sha
    : refuse(`could not find where ${head} branched off ${upstream}`);
}

async function mergeAndReport(
  ctx: Context,
  deps: MergeDeps,
  options: MergeOptions,
): Promise<number> {
  const timing = deps.timing ?? DEFAULT_TIMING;
  const worktrees = await listWorktrees(ctx, ctx.cwd).catch(() =>
    refuse("run merge inside the repository's clone or one of its worktrees"),
  );
  const root = worktrees[0]?.path ?? ctx.cwd;
  const repository = await readRepository(ctx, root);
  const first = await readPullRequest(ctx, options.prNumber, root);
  checkMergeable(first, repository);

  await fetchOrigin(ctx, root);
  const sha = await upToDateTip(ctx, first, repository, root);
  const branch = first.headRefName;
  const pullRequest = await waitForHead(
    ctx,
    deps.sleep,
    timing,
    { prNumber: options.prNumber, sha, branch },
    root,
  );

  const upstream = `origin/${repository.defaultBranch}`;
  const base = await mergeBase(ctx, upstream, sha, root);
  const reasons = await reasonsForMaintainerApproval(ctx, base, sha, root);
  if (reasons.length > 0 && !options.maintainerApproved) {
    refuse(
      `this pull request needs the maintainer's yes: ${reasons.join("; ")}. ` +
        `Ask them; once they say yes in chat, run \`temple-bar merge ${String(options.prNumber)} --maintainer-approved\`.`,
    );
  }
  if (reasons.length > 0) {
    ctx.stdout.write(`merge: maintainer approved: ${reasons.join("; ")}\n`);
  }
  const message = buildSquashMessage(
    pullRequest,
    await readCoAuthors(ctx, `${upstream}..${sha}`, root),
  );

  const required = await readRequiredChecks(ctx, repository, root);
  const checks = await waitForChecks(
    ctx,
    deps.sleep,
    timing,
    { repository, sha, required },
    root,
  );
  ctx.stdout.write(
    `merge: all ${String(checks.length)} checks passed on ${sha}\n`,
  );
  await refuseOnOpenAlerts(ctx, repository, options.prNumber, root);

  // Advice only: a failure to measure must not stop the merge.
  await warnAboutPullRequestSize(
    { ...ctx, cwd: root },
    { base: upstream, head: sha, prNumber: String(options.prNumber) },
  ).catch((error: unknown) => {
    ctx.stdout.write(
      `merge: could not measure the pull request's size: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });

  const merged = await squashMerge(
    ctx,
    {
      prNumber: options.prNumber,
      sha,
      subject: message.subject,
      body: message.body,
    },
    root,
  );
  if (merged.code !== 0) {
    refuse(`GitHub refused the merge: ${describeGhFailure(merged)}`);
  }
  ctx.stdout.write(
    `merge: merged #${String(options.prNumber)} as "${message.subject}"\n`,
  );

  return afterMerge(ctx, {
    repository,
    branch,
    sha,
    root,
    prNumber: options.prNumber,
  });
}

async function afterMerge(
  ctx: Context,
  merged: {
    readonly repository: Repository;
    readonly branch: string;
    readonly sha: string;
    readonly root: string;
    readonly prNumber: number;
  },
): Promise<number> {
  let exitCode = 0;
  const state = (await readPullRequest(ctx, merged.prNumber, merged.root))
    .state;
  if (state !== "MERGED") {
    ctx.stderr.write(
      `merge: GitHub accepted the merge but shows #${String(merged.prNumber)} as ${state}; nothing was cleaned up\n`,
    );
    return 1;
  }

  const cleanup = await cleanUp(ctx, {
    primaryPath: merged.root,
    branch: merged.branch,
    defaultBranch: merged.repository.defaultBranch,
    mergedSha: merged.sha,
  });
  for (const line of cleanup.done) {
    ctx.stdout.write(`merge: ${line}\n`);
  }
  for (const line of cleanup.problems) {
    ctx.stderr.write(`merge: left behind: ${line}\n`);
    exitCode = 1;
  }

  // The analysis of the merge commit itself may still be running, so this
  // reports what's open now rather than waiting for it.
  const alerts = await readOpenAlerts(
    ctx,
    merged.repository,
    { branch: merged.repository.defaultBranch },
    merged.root,
  ).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );
  if (typeof alerts === "string" && alerts !== "not-set-up") {
    ctx.stderr.write(`merge: ${alerts}\n`);
    exitCode = 1;
  } else if (Array.isArray(alerts) && alerts.length > 0) {
    ctx.stderr.write(
      `merge: ${merged.repository.defaultBranch} has open code-scanning alerts: ${describeAlerts(alerts)}\n`,
    );
    exitCode = 1;
  } else if (Array.isArray(alerts)) {
    ctx.stdout.write(
      `merge: no open code-scanning alerts on ${merged.repository.defaultBranch}\n`,
    );
  }

  await reportLeftovers(ctx, merged.root, "merge: ").catch((error: unknown) => {
    ctx.stdout.write(
      `merge: could not look for leftovers: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
  const incidents = await countOpenIncidents(ctx, merged.root);
  ctx.stdout.write(
    incidents === undefined
      ? "merge: could not count the open incident issues\n"
      : `merge: ${String(incidents)} open issue${incidents === 1 ? "" : "s"} labelled incident\n`,
  );
  return exitCode;
}

/** Runs the merge and turns a refusal into its message and exit code 1. */
export async function runMerge(
  ctx: Context,
  deps: MergeDeps,
  options: MergeOptions,
): Promise<number> {
  try {
    return await mergeAndReport(ctx, deps, options);
  } catch (error) {
    if (error instanceof MergeRefusal) {
      ctx.stderr.write(`merge: refused: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
