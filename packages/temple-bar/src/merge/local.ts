// The local git side of a merge: bringing a branch that is behind up to
// date, and tidying up once the pull request has merged. Nothing here ever
// force-pushes or force-removes: an unexpected state stops or is reported,
// rather than overwritten.

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

/** Paths the pull request changes, compared with where it branched off. */
export async function changedFiles(
  ctx: Context,
  base: string,
  head: string,
  cwd: string,
): Promise<string[]> {
  const result = await git(
    ctx,
    ["diff", "--name-only", "--no-renames", `${base}...${head}`],
    cwd,
  );
  if (!result.ok) {
    refuse(
      `could not list the files the pull request changes: ${result.stderr}`,
    );
  }
  return result.stdout.split("\n").filter((file) => file !== "");
}

/** A file's contents at a commit, or undefined when it isn't there. */
export async function fileAt(
  ctx: Context,
  commit: string,
  file: string,
  cwd: string,
): Promise<string | undefined> {
  const result = await ctx.git.run(["show", `${commit}:${file}`], cwd);
  return result.code === 0 ? result.stdout : undefined;
}

export interface CleanupReport {
  readonly done: string[];
  /** Anything left behind, each with what to do about it. */
  readonly problems: string[];
}

async function removeWorktreeOrSwitch(
  ctx: Context,
  worktree: Worktree,
  options: { readonly defaultBranch: string; readonly primaryPath: string },
  report: CleanupReport,
): Promise<void> {
  const { defaultBranch } = options;
  if (worktree.primary) {
    // The original clone is never removed; it goes back to the default
    // branch instead, so the merged branch can be deleted.
    const switched = await git(ctx, ["switch", defaultBranch], worktree.path);
    if (switched.ok) {
      report.done.push(`switched ${worktree.path} to ${defaultBranch}`);
    } else {
      report.problems.push(
        `could not switch ${worktree.path} to ${defaultBranch}: ${switched.stderr}`,
      );
    }
    return;
  }
  // No --force: uncommitted work in the worktree is kept and reported.
  // Run from the primary checkout: git won't remove the worktree it runs in.
  const removed = await git(
    ctx,
    ["worktree", "remove", worktree.path],
    options.primaryPath,
  );
  if (removed.ok) {
    report.done.push(`removed the worktree at ${worktree.path}`);
  } else {
    report.problems.push(
      `left the worktree at ${worktree.path}: ${removed.stderr}. ` +
        "Check it for work to keep, then `git worktree remove` it.",
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

async function remoteBranchExists(
  ctx: Context,
  branch: string,
  cwd: string,
): Promise<boolean | undefined> {
  const result = await git(
    ctx,
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    cwd,
  );
  return result.ok ? result.stdout !== "" : undefined;
}

/** gh can leave the remote branch behind (for example when it is checked
 * out in a worktree), so its absence is confirmed rather than assumed. */
async function confirmRemoteBranchGone(
  ctx: Context,
  branch: string,
  cwd: string,
  report: CleanupReport,
): Promise<void> {
  if ((await remoteBranchExists(ctx, branch, cwd)) === false) {
    report.done.push(`confirmed origin/${branch} is gone`);
    return;
  }
  await git(ctx, ["push", "origin", "--delete", branch], cwd);
  if ((await remoteBranchExists(ctx, branch, cwd)) === false) {
    report.done.push(`deleted origin/${branch} and confirmed it is gone`);
  } else {
    report.problems.push(
      `origin/${branch} is still there: delete it with \`git push origin --delete ${branch}\``,
    );
  }
}

/** After the merge: the worktree, the local branch and the remote branch go;
 * the default branch catches up. Runs from the primary checkout, because
 * the command may have been started inside the worktree it removes. */
export async function cleanUp(
  ctx: Context,
  options: {
    readonly primaryPath: string;
    readonly branch: string;
    readonly defaultBranch: string;
    /** The commit that merged; a local branch anywhere else holds work that
     * didn't, so it is kept. */
    readonly mergedSha: string;
  },
): Promise<CleanupReport> {
  const report: CleanupReport = { done: [], problems: [] };
  const cwd = options.primaryPath;
  await fetchOrigin(ctx, cwd).catch((error: unknown) => {
    report.problems.push(
      error instanceof Error ? error.message : String(error),
    );
  });

  const worktrees = await listWorktrees(ctx, cwd);
  const holder = worktrees.find(
    (worktree) => worktree.branch === options.branch,
  );
  if (holder !== undefined) {
    await removeWorktreeOrSwitch(ctx, holder, options, report);
  }

  const tip = await resolveCommit(ctx, `refs/heads/${options.branch}`, cwd);
  if (tip === options.mergedSha) {
    // -D, because a squash merge never makes the branch an ancestor of the
    // default branch, so git can't tell it merged. The tip check above is
    // what makes this safe.
    const deleted = await git(ctx, ["branch", "-D", options.branch], cwd);
    if (deleted.ok) {
      report.done.push(`deleted the local branch ${options.branch}`);
    } else {
      report.problems.push(
        `could not delete the local branch ${options.branch}: ${deleted.stderr}`,
      );
    }
  } else if (tip !== undefined) {
    report.problems.push(
      `kept the local branch ${options.branch}: it is at ${tip}, not the merged ${options.mergedSha}`,
    );
  }

  const primary = (await listWorktrees(ctx, cwd)).find(
    (worktree) => worktree.primary,
  );
  if (primary !== undefined) {
    await fastForwardDefault(ctx, primary, options.defaultBranch, report);
  }
  await confirmRemoteBranchGone(ctx, options.branch, cwd, report);
  return report;
}
