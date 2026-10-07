// What merge does once GitHub has accepted the squash: confirm it merged,
// tidy up the branch and worktree, and report anything left to deal with.
// Nothing here can undo the merge, so problems are reported with exit code
// 1 rather than thrown as refusals.

import path from "node:path";

import type { Context } from "../context.ts";
import { TEMPLE_BAR_PACKAGE } from "../judge/changes.ts";
import { reportLeftovers } from "../leftovers/report.ts";
import {
  describeAlerts,
  readOpenAlerts,
  readPullRequest,
  type Repository,
} from "./github.ts";
import { cleanUp } from "./local.ts";
import { listWorktrees } from "./worktrees.ts";

/** The first merge on a repo brings temple-bar onto the default branch, but
 * the only checkout that had it installed was the worktree cleanUp just
 * removed. Until some checkout installs it, the git hooks have no
 * temple-bar anywhere and refuse, so say how. When the primary checkout
 * couldn't be fast-forwarded (uncommitted changes, say), its package.json
 * doesn't list temple-bar yet and installing there would bring nothing, so
 * the advice points at a fresh worktree of the merged default branch
 * instead. Reporting only. */
async function adviseInstall(
  ctx: Context,
  root: string,
  defaultBranch: string,
): Promise<void> {
  const primary = (await listWorktrees(ctx, root)).find(
    (worktree) => worktree.primary,
  );
  if (primary?.branch !== defaultBranch) {
    return;
  }
  const bin = path.join(primary.path, "node_modules", ".bin", "temple-bar");
  if (await ctx.fs.exists(bin)) {
    return;
  }
  const hooks =
    "The git hooks refuse commits and pushes while no checkout of this repo has it installed\n";
  if (await listsTempleBar(ctx, primary.path)) {
    ctx.stdout.write(
      `merge: temple-bar is not installed in ${primary.path}: run pnpm install there. ${hooks}`,
    );
  } else {
    ctx.stdout.write(
      `merge: temple-bar is not installed in ${primary.path}, and its ${defaultBranch} does not list it yet: ` +
        `run pnpm install in a new worktree of origin/${defaultBranch} (git worktree add <path> origin/${defaultBranch}). ${hooks}`,
    );
  }
}

async function listsTempleBar(ctx: Context, dir: string): Promise<boolean> {
  const text = await ctx.fs.readText(path.join(dir, "package.json"));
  if (text === undefined) {
    return false;
  }
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    return ["dependencies", "devDependencies"].some((field) => {
      const deps = manifest[field];
      return (
        typeof deps === "object" && deps !== null && TEMPLE_BAR_PACKAGE in deps
      );
    });
  } catch {
    return false;
  }
}

export async function afterMerge(
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

  await adviseInstall(ctx, merged.root, merged.repository.defaultBranch).catch(
    () => undefined,
  );

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
  return exitCode;
}
