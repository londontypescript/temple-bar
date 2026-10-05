// The whole merge of one pull request, start to finish, blocking until it
// is done so it works under any harness, including one that can't be woken
// when checks finish. Each step either passes or stops the merge with a
// refusal that says what to do; nothing is merged until every step passes.
//
// Order matters: things the author must fix (a draft, a branch that can't
// be updated, a change that needs the maintainer) are refused before the
// long wait for checks, so nobody waits half an hour to hear about them.

import type { Context } from "../context.ts";
import { afterMerge } from "./after.ts";
import { ASK_FOR_ADMIN_MERGE } from "../judge/changes.ts";
import {
  ASK_THE_MAINTAINER,
  checkChanges,
  reasonsForMaintainerApproval,
} from "./approval.ts";
import { approvingSection } from "./approving.ts";
import {
  countOpenIncidents,
  readPullRequest,
  readRepository,
  type PullRequest,
  type Repository,
} from "./github.ts";
import { checkAndMerge } from "./land.ts";
import {
  bringUpToDate,
  fetchOrigin,
  isAncestor,
  resolveCommit,
  worktreeForUpdate,
} from "./local.ts";
import { readChanges } from "./manifests.ts";
import { checkOneConcern } from "./one-concern.ts";
import { buildSquashMessage, readCoAuthors } from "./message.ts";
import { MergeRefusal, refuse } from "./refusal.ts";
import {
  DEFAULT_TIMING,
  waitForHead,
  type Sleep,
  type Timing,
} from "./wait.ts";
import { listWorktrees } from "./worktrees.ts";
import type { RunGate } from "../ready/command.ts";
import { writeMark } from "../ready/mark.ts";

export interface MergeDeps {
  readonly sleep: Sleep;
  readonly timing?: Timing;
  /** The full gate, run in a worktree after merge brings its branch up to
   * date; resolves the gate's exit code. */
  readonly runGate: RunGate;
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

/** Brings the branch up to date with the default branch when it's behind,
 * because the ruleset only merges up-to-date branches. Returns the tip that
 * GitHub should now show as the pull request's head. */
async function upToDateTip(
  ctx: Context,
  deps: MergeDeps,
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
  // The merge commit is new, so the pre-push hook wants it marked ready.
  // Merge does what ready does: runs the full gate on it, and marks it only
  // if it passes, since a change that landed on the default branch can
  // break this branch.
  return bringUpToDate(
    ctx,
    worktree,
    branch,
    repository.defaultBranch,
    async (mergedTip) => {
      ctx.stdout.write(
        `merge: running the gate on ${branch} with ${upstream} merged in\n`,
      );
      if ((await deps.runGate({ ...ctx, cwd: worktree.path })) !== 0) {
        refuse(
          `with ${upstream} merged in, ${branch} fails the gate, so nothing was pushed. ` +
            `The merge commit is in ${worktree.path}: fix what the gate reported, commit, ` +
            "run `temple-bar ready`, push, and run merge again.",
        );
      }
      await writeMark(ctx, worktree.path, mergedTip);
    },
  );
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
  checkOneConcern(first);

  await fetchOrigin(ctx, root);
  const sha = await upToDateTip(ctx, deps, first, repository, root);
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
  const changes = await readChanges(ctx, base, sha, root);
  // Printed before any refusal for the maintainer's yes, so the request
  // for that yes can carry it.
  const incidents = await countOpenIncidents(ctx, root);
  for (const line of approvingSection(options.prNumber, changes, incidents)) {
    ctx.stdout.write(`merge: ${line}\n`);
  }
  // A change to the checks fails the judge on purpose, and only the
  // maintainer merges it, past the judge. A yes in chat doesn't change
  // that: merge never goes past a check, so it stops here rather than
  // after the wait, whatever it was told.
  const guarded = checkChanges(changes);
  if (guarded.length > 0) {
    refuse(
      `this pull request changes the checks that judge it: ${guarded.join("; ")}. ` +
        ASK_FOR_ADMIN_MERGE,
    );
  }
  // The flag is the agent's own claim that the maintainer said yes in chat.
  // Merge can't check it, so it records it in the squash message instead,
  // where a merge that skipped the request would show by its absence.
  const reasons = reasonsForMaintainerApproval(changes);
  if (reasons.length > 0 && !options.maintainerApproved) {
    refuse(
      `this pull request needs the maintainer's yes: ${reasons.join("; ")}. ` +
        `${ASK_THE_MAINTAINER}; once they say yes, run \`temple-bar merge ${String(options.prNumber)} --maintainer-approved\`.`,
    );
  }
  if (reasons.length > 0) {
    ctx.stdout.write(`merge: maintainer approved: ${reasons.join("; ")}\n`);
  }
  const message = buildSquashMessage(
    pullRequest,
    await readCoAuthors(ctx, `${upstream}..${sha}`, root),
    reasons,
  );

  await checkAndMerge(
    ctx,
    deps,
    { repository, prNumber: options.prNumber, sha, upstream, message },
    root,
  );
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
