// The local git side of a merge: bringing a branch that is behind up to
// date, and tidying up once the pull request has merged. Nothing here
// rewrites history or removes a folder: an unexpected state stops or is
// reported, rather than overwritten. The one lease, on deleting the remote
// branch, only narrows that deletion to the commit that merged.

import type { Context } from "../context.ts";
import { refuse } from "./refusal.ts";
import { isDirty, listWorktrees, type Worktree } from "./worktrees.ts";

async function git(
  ctx: Context,
  args: readonly string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await ctx.git.run(args, cwd);
  return {
    ok: result.code === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export async function fetchOrigin(ctx: Context, cwd: string): Promise<void> {
  const result = await git(ctx, ["fetch", "--quiet", "origin"], cwd);
  if (!result.ok) {
    refuse(`could not fetch from origin: ${result.stderr}`);
  }
}

/** The commit `ref` names, or undefined when it doesn't exist. */
export async function resolveCommit(
  ctx: Context,
  ref: string,
  cwd: string,
): Promise<string | undefined> {
  const result = await git(
    ctx,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    cwd,
  );
  return result.ok && result.stdout !== "" ? result.stdout : undefined;
}

export async function isAncestor(
  ctx: Context,
  ancestor: string,
  descendant: string,
  cwd: string,
): Promise<boolean> {
  const result = await git(
    ctx,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    cwd,
  );
  return result.ok;
}

/** The worktree with `branch` checked out, refusing when there is none or
 * it has uncommitted work: merging into it then would mix that work in. */
export async function worktreeForUpdate(
  ctx: Context,
  worktrees: readonly Worktree[],
  branch: string,
  why: string,
): Promise<Worktree> {
  const worktree = worktrees.find((candidate) => candidate.branch === branch);
  if (worktree === undefined) {
    refuse(
      `${why}, but no worktree has ${branch} checked out. ` +
        `Check it out in a worktree (git worktree add <path> ${branch}) and run merge again.`,
    );
  }
  if (await isDirty(ctx, worktree.path)) {
    refuse(
      `${why}, but the worktree at ${worktree.path} has uncommitted changes. ` +
        "Commit or stash them, then run merge again.",
    );
  }
  return worktree;
}

/** Merges origin's default branch into the branch in its worktree and
 * pushes it. A plain push, never a forced one: the branch only gains a
 * merge commit, so nothing on GitHub is rewritten. `beforePush` sees the
 * new tip first and can refuse, leaving the merge commit local. Returns the
 * new tip. */
export async function bringUpToDate(
  ctx: Context,
  worktree: Worktree,
  branch: string,
  defaultBranch: string,
  beforePush: (tip: string) => Promise<void>,
): Promise<string> {
  const upstream = `origin/${defaultBranch}`;
  const merged = await git(
    ctx,
    ["merge", "--no-edit", "--no-ff", upstream],
    worktree.path,
  );
  if (!merged.ok) {
    const conflicts = await git(
      ctx,
      ["diff", "--name-only", "--diff-filter=U"],
      worktree.path,
    );
    await git(ctx, ["merge", "--abort"], worktree.path);
    const files = conflicts.stdout.split("\n").filter((file) => file !== "");
    refuse(
      files.length > 0
        ? `merging ${upstream} into ${branch} conflicts in: ${files.join(", ")}. ` +
            "Resolve the merge yourself in that worktree, push, and run merge again."
        : `could not merge ${upstream} into ${branch}: ${merged.stderr}`,
    );
  }
  const mergedTip = await resolveCommit(
    ctx,
    `refs/heads/${branch}`,
    worktree.path,
  );
  await beforePush(
    mergedTip ?? refuse(`could not read ${branch} after merging ${upstream}`),
  );
  const pushed = await git(
    ctx,
    ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
    worktree.path,
  );
  if (!pushed.ok) {
    refuse(
      `merged ${upstream} into ${branch} locally, but the push failed: ${pushed.stderr}`,
    );
  }
  const tip = await resolveCommit(ctx, `refs/heads/${branch}`, worktree.path);
  return tip ?? refuse(`could not read ${branch} after the push`);
}

export interface CleanupReport {
  readonly done: string[];
  /** Anything left behind, each with what to do about it. */
  readonly problems: string[];
  /** Whether the merged branch is still a local branch once cleanup ends.
   * Merge never deletes it, so only something else can have. */
  readonly keptBranch: boolean;
}

/** The original clone holding the merged branch goes back to the default
 * branch, so the default branch can be fast-forwarded there. The branch
 * itself stays. */
async function switchPrimaryToDefault(
  ctx: Context,
  primary: Worktree,
  defaultBranch: string,
  report: CleanupReport,
): Promise<void> {
  const switched = await git(ctx, ["switch", defaultBranch], primary.path);
  if (switched.ok) {
    report.done.push(`switched ${primary.path} to ${defaultBranch}`);
  } else {
    report.problems.push(
      `could not switch ${primary.path} to ${defaultBranch}: ${switched.stderr}`,
    );
  }
}

async function fastForwardDefault(
  ctx: Context,
  primary: Worktree,
  defaultBranch: string,
  report: CleanupReport,
): Promise<void> {
  if (primary.branch !== defaultBranch) {
    return;
  }
  if (await isDirty(ctx, primary.path)) {
    report.problems.push(
      `did not update ${defaultBranch} in ${primary.path}: it has uncommitted changes`,
    );
    return;
  }
  const result = await git(
    ctx,
    ["merge", "--ff-only", "--quiet", `origin/${defaultBranch}`],
    primary.path,
  );
  if (result.ok) {
    report.done.push(`fast-forwarded ${defaultBranch} in ${primary.path}`);
  } else {
    report.problems.push(
      `could not fast-forward ${defaultBranch} in ${primary.path}: ${result.stderr}`,
    );
  }
}

/** origin's branch as `ls-remote` reads it. */
type RemoteTip =
  | { readonly kind: "at"; readonly tip: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" };

async function readRemoteTip(
  ctx: Context,
  branch: string,
  cwd: string,
): Promise<RemoteTip> {
  const ref = `refs/heads/${branch}`;
  const result = await git(ctx, ["ls-remote", "--heads", "origin", ref], cwd);
  if (!result.ok) {
    return { kind: "unreadable" };
  }
  for (const line of result.stdout.split("\n")) {
    const [tip = "", name = ""] = line.trim().split(/\s+/);
    if (name === ref && tip !== "") {
      return { kind: "at", tip };
    }
  }
  return { kind: "absent" };
}

/** Deletes origin's branch only while its tip is still the merged commit.
 * Someone may push to it between GitHub's merge and this step, and deleting
 * it then would lose the only remote copy of that newer work. The lease is
 * the check: git sends the deletion with the commit it expects, and origin
 * refuses it if the branch has moved, so there is no gap between a check
 * and the delete. The read before it only tells a branch GitHub or gh has
 * already deleted from one still to delete; the read after a failure is
 * only to explain it, never to try again. */
async function deleteRemoteBranch(
  ctx: Context,
  branch: string,
  mergedSha: string,
  cwd: string,
  report: CleanupReport,
): Promise<void> {
  const gone = `confirmed origin/${branch} is gone`;
  if ((await readRemoteTip(ctx, branch, cwd)).kind === "absent") {
    report.done.push(gone);
    return;
  }
  const ref = `refs/heads/${branch}`;
  const pushed = await git(
    ctx,
    ["push", `--force-with-lease=${ref}:${mergedSha}`, "origin", `:${ref}`],
    cwd,
  );
  if (pushed.ok) {
    report.done.push(
      `deleted origin/${branch}, whose tip was still the merged ${mergedSha}`,
    );
    return;
  }
  // Only git's "stale info" rejection says the tip wasn't the merged commit.
  // Any other failure (a rule, a permission, the server) says nothing about
  // the tip, so it is never reported as newer work on that evidence alone.
  const stale = pushed.stderr.includes("(stale info)");
  const now = await readRemoteTip(ctx, branch, cwd);
  if (now.kind === "absent") {
    report.done.push(gone);
  } else if (now.kind === "at" && now.tip !== mergedSha) {
    report.problems.push(
      `kept origin/${branch}: its tip is ${now.tip}, not the merged ${mergedSha}, so it holds work that didn't merge. ` +
        "Look at it before deleting it.",
    );
  } else {
    const why = stale
      ? `git refused to delete it because its tip was not the merged ${mergedSha} when it pushed`
      : "the push failed";
    const tip =
      now.kind === "at"
        ? `its tip now reads as the merged ${mergedSha}`
        : "its tip could not be read afterwards, so look at it before deleting it";
    report.problems.push(
      `could not delete origin/${branch}: ${why}, and ${tip}. git said: ${pushed.stderr}`,
    );
  }
}

/** Where the merged branch is kept, read once cleanup has acted. */
async function reportKept(
  ctx: Context,
  branch: string,
  mergedSha: string,
  cwd: string,
  report: CleanupReport,
): Promise<boolean> {
  const tip = await resolveCommit(ctx, `refs/heads/${branch}`, cwd);
  if (tip === undefined) {
    return false;
  }
  // A tip elsewhere holds work that didn't merge. Nothing is deleted either
  // way, so this is information, not a problem.
  const at =
    tip === mergedSha ? tip : `${tip}, which is not the merged ${mergedSha}`;
  const holder = (await listWorktrees(ctx, cwd)).find(
    (worktree) => worktree.branch === branch,
  );
  if (holder === undefined) {
    report.done.push(`kept the local branch ${branch} at ${at}`);
  } else if (holder.primary) {
    report.done.push(
      `kept the local branch ${branch} at ${at}, still checked out in ${holder.path}`,
    );
  } else {
    report.done.push(
      `kept the worktree at ${holder.path} on ${branch} (${at}); ` +
        "your harness removes it when it is done, or inspect it with temple-bar leftovers",
    );
  }
  return true;
}

/** After the merge: the default branch catches up and the remote branch
 * goes, then the report says where the worktree and the local branch are.
 * Runs from the primary checkout.
 *
 * Merge never removes the merged branch's worktree or its local branch. The
 * command may have been started by a session working in that very folder,
 * and deleting it would take the session's working folder away. The harness
 * that made the worktree removes it when it is done, and `temple-bar
 * leftovers` lists what is left for a person to remove (it only reports).
 * ADR 0016 has the full story. */
export async function cleanUp(
  ctx: Context,
  options: {
    readonly primaryPath: string;
    readonly branch: string;
    readonly defaultBranch: string;
    /** The commit GitHub accepted as the pull request's head: origin's
     * branch is deleted only while it is still there. */
    readonly mergedSha: string;
  },
): Promise<CleanupReport> {
  const report: CleanupReport = { done: [], problems: [], keptBranch: false };
  const cwd = options.primaryPath;
  await fetchOrigin(ctx, cwd).catch((error: unknown) => {
    report.problems.push(
      error instanceof Error ? error.message : String(error),
    );
  });

  const holder = (await listWorktrees(ctx, cwd)).find(
    (worktree) => worktree.branch === options.branch,
  );
  if (holder?.primary === true) {
    await switchPrimaryToDefault(ctx, holder, options.defaultBranch, report);
  }

  const primary = (await listWorktrees(ctx, cwd)).find(
    (worktree) => worktree.primary,
  );
  if (primary !== undefined) {
    await fastForwardDefault(ctx, primary, options.defaultBranch, report);
  }
  await deleteRemoteBranch(ctx, options.branch, options.mergedSha, cwd, report);
  const keptBranch = await reportKept(
    ctx,
    options.branch,
    options.mergedSha,
    cwd,
    report,
  );
  return { ...report, keptBranch };
}
