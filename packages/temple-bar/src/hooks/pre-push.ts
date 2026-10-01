// Logic behind `temple-bar hook pre-push <remote> <url>`. Two checks on what
// is about to leave the machine:
//
//   1. A force push is refused: any update that would replace commits GitHub
//      already has rather than add to them. A pushed branch is brought up to
//      date by merging `main` into it, so its history is only ever added to.
//      This holds for every tool, not only the ones with their own
//      permission check.
//   2. A branch that is too big gets the pull request size warning, but is
//      never blocked: planning should have kept it small long before this
//      last look. The CI step is the strict one, so if measuring fails here
//      the reason is printed and the push goes ahead.
//
// Pushes to the default branch itself are already refused elsewhere (the
// GitHub ruleset and the reference-transaction hook), so this hook leaves
// them alone. Only branches are judged: tags are not pull requests, and
// moving one is not a rewrite of a branch's history.

import type { Context } from "../context.ts";
import { checkPullRequestSize, formatSizeReport } from "../pr/size.ts";
import { findProtectedBranch } from "./protected-branch.ts";

interface PushedRef {
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
}

const BRANCH_PREFIX = "refs/heads/";
const ZERO_SHA = /^0+$/;

/**
 * Parses pre-push stdin: one `<local ref> <local sha> <remote ref> <remote
 * sha>` line per ref being pushed (git's documented format). Blank and
 * malformed lines are skipped.
 */
export function parsePushedRefs(stdin: string): PushedRef[] {
  const refs: PushedRef[] = [];
  for (const line of stdin.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) {
      continue;
    }
    const [, localSha, remoteRef, remoteSha] = parts as [
      string,
      string,
      string,
      string,
    ];
    refs.push({ localSha, remoteRef, remoteSha });
  }
  return refs;
}

type Verdict = "fast-forward" | "rewrites" | "unknown";

/** Whether pushing `ref` adds to what GitHub has, or replaces some of it. */
async function judgePush(ref: PushedRef, ctx: Context): Promise<Verdict> {
  // If GitHub's commit isn't in this clone, git can't say whether the push
  // would drop it. Guessing "fine" would let a rewrite through.
  const present = await ctx.git.run(
    ["cat-file", "-e", `${ref.remoteSha}^{commit}`],
    ctx.cwd,
  );
  if (present.code !== 0) {
    return "unknown";
  }
  const ancestor = await ctx.git.run(
    ["merge-base", "--is-ancestor", ref.remoteSha, ref.localSha],
    ctx.cwd,
  );
  if (ancestor.code === 0) {
    return "fast-forward";
  }
  return ancestor.code === 1 ? "rewrites" : "unknown";
}

function branchName(ref: PushedRef): string {
  return ref.remoteRef.slice(BRANCH_PREFIX.length);
}

const REWRITE_ADVICE =
  "Bring a branch up to date by merging main into it; never rewrite a pushed branch.\n";

function describeRewrite(ref: PushedRef): string {
  return (
    `temple-bar: refusing to push ${branchName(ref)}: it would replace commits already on GitHub (a force push).\n` +
    REWRITE_ADVICE
  );
}

function describeUnknown(ref: PushedRef): string {
  return (
    `temple-bar: refusing to push ${branchName(ref)}: GitHub's copy of it (${ref.remoteSha.slice(0, 7)}) isn't in this clone, so it can't be checked that the push only adds commits.\n` +
    "Run git fetch, then push again.\n" +
    REWRITE_ADVICE
  );
}

async function warnIfTooBig(
  ref: PushedRef,
  defaultBranch: string,
  ctx: Context,
): Promise<void> {
  try {
    const report = await checkPullRequestSize(ctx, {
      base: `origin/${defaultBranch}`,
      head: ref.localSha,
      skipPullRequestText: true,
    });
    if (report.problems.length > 0) {
      ctx.stderr.write(formatSizeReport(report));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(
      `temple-bar: could not check the size of ${branchName(ref)}, pushing anyway: ${message}\n`,
    );
  }
}

/** Exit 1 when any pushed branch would be force-pushed, else 0. */
export async function prePushCheck(
  stdin: string,
  ctx: Context,
): Promise<number> {
  // Deleting a branch (local sha all zeros) is allowed: it removes a branch
  // and rewrites nothing, and `gh` and `temple-bar merge` delete merged
  // branches this way.
  const pushed = parsePushedRefs(stdin).filter(
    (ref) =>
      ref.remoteRef.startsWith(BRANCH_PREFIX) && !ZERO_SHA.test(ref.localSha),
  );
  if (pushed.length === 0) {
    return 0;
  }
  const defaultBranch = await findProtectedBranch(ctx, ctx.cwd);

  let refused = false;
  for (const ref of pushed) {
    // A new branch (remote sha all zeros) has nothing on GitHub to replace.
    if (!ZERO_SHA.test(ref.remoteSha)) {
      const verdict = await judgePush(ref, ctx);
      if (verdict !== "fast-forward") {
        ctx.stderr.write(
          verdict === "rewrites" ? describeRewrite(ref) : describeUnknown(ref),
        );
        refused = true;
        continue;
      }
    }
    if (branchName(ref) !== defaultBranch) {
      await warnIfTooBig(ref, defaultBranch, ctx);
    }
  }
  return refused ? 1 : 0;
}
