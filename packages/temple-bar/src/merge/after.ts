// What merge does once GitHub has accepted the squash: confirm it merged,
// tidy up, say where the branch's worktree and local branch are kept, and
// report anything left to deal with. Nothing here can undo the merge, so
// problems are reported with exit code 1 rather than thrown as refusals.

import path from "node:path";

import type { Context } from "../context.ts";
import { TEMPLE_BAR_PACKAGE } from "../judge/manifests.ts";
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
 * the primary checkout doesn't have it installed yet: the merged branch's
 * worktree is where it was installed. Merge keeps that worktree, so the git
 * hooks still find temple-bar there for now, but once it is removed no
 * checkout has it and the hooks refuse. So say how to install it in the
 * primary checkout. When that checkout couldn't be fast-forwarded
 * (uncommitted changes, say), its package.json doesn't list temple-bar yet
 * and installing there would bring nothing, so the advice points at a
 * fresh worktree of the merged default branch instead. Reporting only. */
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
    "Until then the git hooks use another checkout that has it, such as the merged branch's worktree, " +
    "and refuse commits and pushes once no checkout of this repo has it installed\n";
  if (await listsTempleBar(ctx, primary.path)) {
    ctx.stdout.write(
      `merge: temple-bar is not installed in ${primary.path}: run pnpm install there. ${hooks}`,
    );
  } else {
    ctx.stdout.write(
      `merge: temple-bar is not installed in ${primary.path}, and its ${defaultBranch} does not list it yet: ` +
        `run pnpm install in a new worktree of origin/${defaultBranch}, made by your harness. ${hooks}`,
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

  // What merge kept on purpose is listed next as leftovers, for a person or
  // the harness to remove, when the report can call it finished. It leaves
  // out a branch with work that didn't merge, as it does anything it can't
  // check, so its "none" mustn't read as all clean when merge kept a branch
  // or left something behind.
  const incomplete = cleanup.problems.length > 0;
  await reportLeftovers(
    ctx,
    merged.root,
    "merge: leftovers: ",
    incomplete
      ? "git lists no other leftover branches or worktrees"
      : cleanup.keptBranch
        ? "none finished, so check what merge kept above before removing it"
        : undefined,
  ).catch((error: unknown) => {
    ctx.stdout.write(
      `merge: could not look for leftovers: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
  if (incomplete) {
    ctx.stderr.write(
      'merge: cleanup is incomplete: see "left behind" above. The pull request itself merged.\n',
    );
  }
  return exitCode;
}
