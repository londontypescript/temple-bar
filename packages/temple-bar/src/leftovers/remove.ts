// `temple-bar leftovers --remove`: deletes what the classification allows
// and reports the rest with its reason. Before each worktree goes, it is
// claimed (so a racing `--unrelease` can't also succeed) and its whole
// verdict is reached again from fresh reads; only the pull request list is
// reused. Deletion never forces: git's own refusals still stand under every
// check here. ADR 0022 has the story.

import type { Context } from "../context.ts";
import { listWorktrees } from "../merge/worktrees.ts";
import { classify, type Classification } from "./classify.ts";
import { claim, dropClaim } from "./marker.ts";
import { samePath } from "./paths.ts";
import { deleteUnderLease } from "./remote-branch.ts";
import { reasonsOf } from "./finished.ts";
import {
  readCommonDir,
  readRepo,
  refusalsToStart,
  type Repo,
} from "./repository.ts";
import { judgeWorktree, type WorktreeItem } from "./worktree-verdict.ts";

interface Outcome {
  readonly line: string;
  readonly ok: boolean;
}

const AGAIN = "the session there must release it again for it to be removed";

/** Claims, re-checks and removes one worktree the classification allows. */
async function removeWorktree(
  ctx: Context,
  repo: Repo,
  item: WorktreeItem,
): Promise<Outcome> {
  const at = item.worktree.path;
  const what = `the worktree at ${at} (${item.worktree.branch ?? "detached"})`;
  const kept = (why: string): Outcome => ({
    line: `kept ${what}: ${why}`,
    ok: false,
  });
  if (item.released === undefined) {
    return kept("it has no release to claim");
  }
  const refused = await claim(ctx, at, item.released);
  if (refused !== undefined) {
    return kept(
      `couldn't claim it, so its release was withdrawn or changed (git said: ${refused})`,
    );
  }
  const blob = item.released;
  const giveBack = async (why: string): Promise<Outcome> => {
    const dropped = await dropClaim(ctx, at, blob);
    return kept(
      dropped === undefined
        ? `${why}; ${AGAIN}`
        : `${why}, and its claim couldn't be dropped (git said: ${dropped})`,
    );
  };
  // Everything again, read fresh, but GitHub's pull request list.
  const fresh = await readRepo(ctx, repo.primary.path, {
    pullRequests: repo.pullRequests,
    remote: false,
  }).catch(() => undefined);
  const listed = fresh?.worktrees.find((worktree) =>
    samePath(worktree.path, at),
  );
  const again =
    fresh === undefined || listed === undefined
      ? undefined
      : await judgeWorktree(ctx, fresh, listed, { blob });
  if (again?.verdict.remove !== true) {
    return giveBack(
      again === undefined
        ? "it couldn't be checked again after claiming it"
        : reasonsOf(again.verdict),
    );
  }
  const removed = await ctx.git.run(
    ["worktree", "remove", "--", at],
    repo.primary.path,
  );
  if (removed.code !== 0) {
    return giveBack(`git refused to remove it: ${removed.stderr.trim()}`);
  }
  const after = await listWorktrees(ctx, repo.primary.path).catch(
    () => undefined,
  );
  if (
    after === undefined ||
    after.some((worktree) => samePath(worktree.path, at))
  ) {
    const why =
      after === undefined
        ? "git couldn't list its worktrees afterwards"
        : "git still lists it";
    return { line: `could not confirm ${what} is gone: ${why}`, ok: false };
  }
  // git can report success and stop listing a worktree yet leave its
  // folder, so the folder itself must be gone before it counts as removed.
  const left = await ctx.fs.classify(at).catch(() => "unreadable");
  if (left !== "missing") {
    return {
      line: `git removed its record of ${what}, but its folder is still there`,
      ok: false,
    };
  }
  return { line: `removed ${what}`, ok: true };
}

/** Deletes a finished local branch no worktree holds, re-listed right
 * before, with its tip as the old value: a branch that moved is kept. */
async function removeLocalBranches(
  ctx: Context,
  found: Classification,
  /** Branches whose worktree this run meant to remove but kept. */
  keptWith: ReadonlyMap<string, string>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const cwd = found.repo.primary.path;
  for (const item of found.localBranches) {
    const label = `the local branch ${item.name}`;
    const ref = `refs/heads/${item.name}`;
    // A failed removal can leave the folder after git has stopped listing
    // it, so the re-list alone can't be trusted to keep the branch.
    const keptAt = keptWith.get(ref);
    if (!item.verdict.remove || keptAt !== undefined) {
      outcomes.push({
        line: `kept ${label}: ${keptAt === undefined ? reasonsOf(item.verdict) : `its worktree at ${keptAt} was kept`}`,
        ok: false,
      });
      continue;
    }
    const worktrees = await listWorktrees(ctx, cwd).catch(() => undefined);
    const holder = worktrees?.find((worktree) => worktree.branchRef === ref);
    if (worktrees === undefined || holder !== undefined) {
      outcomes.push({
        line: `kept ${label}: ${holder === undefined ? "the worktrees couldn't be listed again" : `it is checked out in ${holder.path}`}`,
        ok: false,
      });
      continue;
    }
    const deleted = await ctx.git.run(
      ["update-ref", "--no-deref", "-d", ref, item.tip],
      cwd,
    );
    outcomes.push(
      deleted.code === 0
        ? {
            line: `deleted ${label}, whose tip ${item.tip} is in pull request #${String(item.pullRequest?.number ?? 0)}`,
            ok: true,
          }
        : {
            line: `kept ${label}: it moved, or git refused (git said: ${deleted.stderr.trim()})`,
            ok: false,
          },
    );
  }
  return outcomes;
}

async function removeRemoteBranches(
  ctx: Context,
  found: Classification,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const item of found.remoteBranches) {
    if (!item.verdict.remove || item.pullRequest === undefined) {
      outcomes.push({
        line: `kept origin/${item.name}: ${reasonsOf(item.verdict)}`,
        ok: false,
      });
      continue;
    }
    const result = await deleteUnderLease(
      ctx,
      item.name,
      item.pullRequest.head,
      found.repo.primary.path,
    );
    outcomes.push(
      result.done === undefined
        ? { line: result.problem ?? "", ok: false }
        : { line: result.done, ok: true },
    );
  }
  return outcomes;
}

/** Removes what may go; exit 0 only when nothing was kept, failed or left
 * unchecked. */
export async function removeLeftovers(
  ctx: Context,
  prefix: string,
): Promise<number> {
  const refusals = await refusalsToStart(
    ctx,
    await readCommonDir(ctx, ctx.cwd),
  );
  if (refusals.length > 0) {
    ctx.stderr.write(
      `${prefix}refused, nothing deleted:\n${refusals.map((why) => `${prefix}  ${why}\n`).join("")}`,
    );
    return 1;
  }
  const found = await classify(
    ctx,
    await readRepo(ctx, ctx.cwd, { remote: true }),
  );
  const outcomes: Outcome[] = [];
  const keptWith = new Map<string, string>();
  for (const item of found.worktrees) {
    const outcome = item.verdict.remove
      ? await removeWorktree(ctx, found.repo, item)
      : {
          line: `kept the worktree at ${item.worktree.path} (${item.worktree.branch ?? "detached"}): ${reasonsOf(item.verdict)}`,
          ok: false,
        };
    if (!outcome.ok && item.worktree.branchRef !== undefined) {
      keptWith.set(item.worktree.branchRef, item.worktree.path);
    }
    outcomes.push(outcome);
  }
  outcomes.push(...(await removeLocalBranches(ctx, found, keptWith)));
  outcomes.push(...(await removeRemoteBranches(ctx, found)));
  for (const { line, ok } of outcomes) {
    (ok ? ctx.stdout : ctx.stderr).write(`${prefix}${line}\n`);
  }
  for (const what of found.unchecked) {
    ctx.stderr.write(`${prefix}not checked: ${what}\n`);
  }
  if (outcomes.length === 0 && found.unchecked.length === 0) {
    ctx.stdout.write(`${prefix}nothing left behind\n`);
  }
  return outcomes.every(({ ok }) => ok) && found.unchecked.length === 0 ? 0 : 1;
}
