// The verdict on one linked worktree: every check in ADR 0022, from the
// branch being finished to the release marker still being valid. The report
// prints it, and `--remove` runs it again in full after claiming the
// worktree, right before deleting it.

import type { Context } from "../context.ts";
import type { Worktree } from "../merge/worktrees.ts";
import { inspectContents, type Contents } from "./checks.ts";
import { finished, verdict, type Verdict } from "./finished.ts";
import { checksums } from "./inventory.ts";
import {
  readMarker,
  readMarkerRefs,
  sameFiles,
  type MarkerRefs,
} from "./marker.ts";
import {
  firstFew,
  isInside,
  samePath,
  undecodable,
  withoutNewline,
} from "./paths.ts";
import type { PullRequestFacts, Repo } from "./repository.ts";

export interface WorktreeItem {
  readonly worktree: Worktree;
  readonly pullRequest: PullRequestFacts | undefined;
  readonly verdict: Verdict;
  /** The `released` marker's blob, which `--remove` claims. */
  readonly released: string | undefined;
}

/** Whether a `--remove` run is checking a worktree it has claimed: the
 * marker is then the `removing` blob it owns. */
export type Claim = { readonly blob: string } | undefined;

/** The marker is valid only when, read fresh, it parses, names the branch
 * the worktree is on, names exactly its HEAD, and its files are identical
 * to the ignored files recomputed now. */
async function markerProblems(
  ctx: Context,
  worktree: string,
  refs: MarkerRefs,
  claim: Claim,
  contents: Contents,
): Promise<string[]> {
  if (refs.kind === "unreadable") {
    return [refs.why];
  }
  if (claim === undefined && refs.removing !== undefined) {
    return ["another run has claimed it for removal"];
  }
  if (claim !== undefined && refs.released !== undefined) {
    return ["it was released again after this run claimed it"];
  }
  if (claim !== undefined && refs.removing !== claim.blob) {
    return ["this run's claim on it has changed"];
  }
  const oid = claim?.blob ?? refs.released;
  if (oid === undefined) {
    return [
      "not released: the session there hasn't run `temple-bar leftovers --release`",
    ];
  }
  const marker = await readMarker(ctx, worktree, oid);
  if (marker === undefined) {
    return ["its release marker can't be read"];
  }
  const problems: string[] = [];
  const branch = await ctx.git.run(["symbolic-ref", "-q", "HEAD"], worktree);
  const now = branch.code === 0 ? withoutNewline(branch.stdout) : undefined;
  if (now !== marker.branch) {
    problems.push(
      `released on ${marker.branch}, but now on ${now ?? "no branch"}`,
    );
  }
  const head = await ctx.git.run(
    ["rev-parse", "--verify", "-q", "HEAD"],
    worktree,
  );
  const at = head.code === 0 ? withoutNewline(head.stdout) : undefined;
  if (at !== marker.head) {
    problems.push(
      `HEAD moved since it was released (from ${marker.head} to ${at ?? "unknown"})`,
    );
  }
  // Without git's lists the worktree is already kept for that reason.
  if (contents.inventory !== undefined) {
    const files = await checksums(ctx, worktree, contents.inventory.ignored);
    if (typeof files === "string") {
      problems.push(
        `its ignored files can't be compared with its release: ${files}`,
      );
    } else {
      const changed = sameFiles(files, marker.files);
      if (changed.length > 0) {
        problems.push(
          `ignored files changed since it was released: ${firstFew(changed)}`,
        );
      }
    }
  }
  return problems;
}

/** Neither this command's folder, nor the folder pnpm started in
 * (INIT_CWD), nor the shell's (PWD) may be inside the worktree: deleting it
 * would take a live session's folder away. Compared by real path, so
 * `/var` and `/private/var` are the same folder. */
async function folderInUse(
  ctx: Context,
  worktree: string,
): Promise<{ reasons: string[]; realPath: string | undefined }> {
  const realPath = await ctx.fs.realpath(worktree).catch(() => undefined);
  if (realPath === undefined) {
    return { reasons: ["its real path can't be resolved"], realPath };
  }
  const reasons: string[] = [];
  for (const [label, folder] of [
    ["this command's folder", ctx.cwd],
    ["INIT_CWD", ctx.env.INIT_CWD],
    ["PWD", ctx.env.PWD],
  ] as const) {
    if (folder === undefined || folder === "") {
      continue;
    }
    const real = await ctx.fs.realpath(folder).catch(() => undefined);
    if (real === undefined) {
      reasons.push(`${label} (${folder}) can't be resolved`);
    } else if (isInside(real, realPath) || isInside(folder, worktree)) {
      reasons.push(`${label} is inside it`);
    }
  }
  return { reasons, realPath };
}

/** The verdict on one linked worktree, or undefined when it isn't left
 * behind (live work: an open pull request, or none). */
export async function judgeWorktree(
  ctx: Context,
  repo: Repo,
  worktree: Worktree,
  claim: Claim,
): Promise<WorktreeItem | undefined> {
  const item = (
    reasons: readonly string[],
    pullRequest?: PullRequestFacts,
    released?: string,
  ): WorktreeItem => ({
    worktree,
    pullRequest,
    verdict: verdict(reasons),
    released,
  });
  if (worktree.primary) {
    return undefined;
  }
  if (worktree.prunable) {
    return item([
      "its folder is gone; `git worktree prune` drops it from git's list",
    ]);
  }
  if (worktree.branchRef === undefined) {
    return item(["its HEAD is detached"]);
  }
  if (repo.localRefs === undefined) {
    // Without the branch list, nothing local can be judged; the report
    // says so once. A finished pull request is still worth listing.
    const newest = repo.pullRequests?.get(worktree.branchRef);
    return newest?.kind === "known" && newest.pullRequest.state !== "OPEN"
      ? item(["local branches couldn't be listed"], newest.pullRequest)
      : undefined;
  }
  const local = repo.localRefs.get(worktree.branchRef);
  if (local === undefined) {
    return item([`its branch ${worktree.branchRef} no longer exists`]);
  }
  const state = await finished(ctx, repo, worktree.branchRef, local.tip);
  if (state.kind === "unreported") {
    return undefined;
  }
  if (state.reasons.length > 0) {
    return item(state.reasons, state.pullRequest);
  }
  const reasons: string[] = [...repo.blockers];
  if (local.symref !== "") {
    reasons.push(`its branch is a symbolic ref to ${local.symref}`);
  }
  if (worktree.branch === repo.defaultBranch) {
    reasons.push("it holds the default branch");
  }
  if (undecodable(worktree.path)) {
    reasons.push("its path isn't valid UTF-8, so it can't be checked");
  }
  reasons.push(...(await identityProblems(ctx, repo, worktree.path)));
  if (worktree.locked) {
    reasons.push(
      `locked by another tool${worktree.lockReason === undefined ? "" : ` (${worktree.lockReason})`}`,
    );
  }
  const inUse = await folderInUse(ctx, worktree.path);
  reasons.push(...inUse.reasons);
  const refs = await readMarkerRefs(ctx, worktree.path);
  const contents = await inspectContents(
    ctx,
    { path: worktree.path, realPath: inUse.realPath },
    repo.worktrees,
    refs,
  );
  reasons.push(...contents.reasons);
  reasons.push(
    ...(await markerProblems(ctx, worktree.path, refs, claim, contents)),
  );
  const released = refs.kind === "read" ? refs.released : undefined;
  return item(reasons, state.pullRequest, released);
}

/** The worktree must be this repository's, and git must see it at the
 * path it is listed under. */
async function identityProblems(
  ctx: Context,
  repo: Repo,
  worktree: string,
): Promise<string[]> {
  const common = await ctx.git.run(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    worktree,
  );
  const top = await ctx.git.run(["rev-parse", "--show-toplevel"], worktree);
  const commonDir =
    common.code === 0 ? withoutNewline(common.stdout) : undefined;
  const topLevel = top.code === 0 ? withoutNewline(top.stdout) : undefined;
  const problems: string[] = [];
  if (
    commonDir === undefined ||
    repo.commonDir === undefined ||
    !samePath(commonDir, repo.commonDir)
  ) {
    problems.push(
      `it belongs to another repository (${commonDir ?? "unknown"})`,
    );
  }
  if (topLevel === undefined || !samePath(topLevel, worktree)) {
    problems.push(
      `git sees its top folder as ${topLevel ?? "unknown"}, not the listed path`,
    );
  }
  return problems;
}
