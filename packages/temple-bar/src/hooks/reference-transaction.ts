// Logic behind `temple-bar hook reference-transaction <state>`. The local
// default branch (protected-branch.ts: `main`, `master` or whatever GitHub
// reports) may only move to a commit that is already on GitHub's copy of it,
// so it changes only through merged pull requests. Deleting it is refused,
// and so is every update to it when nothing is known about GitHub's copy,
// since there is then nothing safe to compare against.
//
// git runs this hook for every ref change, including `commit --no-verify`,
// `reset`, `merge` and `fetch`, which is why it, not pre-commit, is the
// guarantee.
//
// Only the "prepared" state does anything; the shim (shims.ts) already
// filters this before starting Node, but the command re-checks it so calling
// this directly behaves the same way.

import type { Context } from "../context.ts";
import { fetchedFromOrigin } from "./fetch-head.ts";
import { findProtectedBranch, upstreamRefFor } from "./protected-branch.ts";

interface RefUpdate {
  readonly oldValue: string;
  readonly newValue: string;
  readonly ref: string;
}

const ZERO_OID_PATTERN = /^0+$/;

/**
 * Parses reference-transaction stdin: one `<old-value> <new-value> <ref>`
 * line per updated ref (git's documented format). Blank lines and malformed
 * lines are skipped rather than treated as errors, since a shell pipeline
 * upstream of this may add a trailing blank line.
 */
function parseRefUpdates(stdin: string): RefUpdate[] {
  const updates: RefUpdate[] = [];
  for (const line of stdin.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 3) {
      continue;
    }
    const [oldValue, newValue, ref] = parts as [string, string, string];
    updates.push({ oldValue, newValue, ref });
  }
  return updates;
}

async function findRepoRoot(ctx: Context): Promise<string | undefined> {
  const result = await ctx.git.run(["rev-parse", "--show-toplevel"], ctx.cwd);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * Every commit known to be GitHub's copy of `branch` right now: the
 * remote-tracking ref as it stands, the value this same transaction is
 * writing to it (`git fetch --atomic origin main:main` updates both refs at
 * once), and what a running fetch just received for it (a plain
 * `git fetch origin main:main` moves local `main` before the remote-tracking
 * ref; see fetch-head.ts).
 */
async function gitHubCommits(
  ctx: Context,
  repoRoot: string,
  branch: string,
  updates: readonly RefUpdate[],
): Promise<string[]> {
  const upstreamRef = upstreamRefFor(branch);
  const commits: string[] = [];

  const current = await ctx.git.run(
    ["rev-parse", "--verify", "--quiet", upstreamRef],
    repoRoot,
  );
  if (current.code === 0) {
    commits.push(current.stdout.trim());
  }

  for (const update of updates) {
    if (update.ref === upstreamRef && !ZERO_OID_PATTERN.test(update.newValue)) {
      commits.push(update.newValue);
    }
  }

  const fetched = await fetchedFromOrigin(ctx, repoRoot, branch);
  if (fetched !== undefined) {
    commits.push(fetched);
  }

  return [...new Set(commits)];
}

async function isAncestorOfAny(
  ctx: Context,
  repoRoot: string,
  sha: string,
  commits: readonly string[],
): Promise<boolean> {
  for (const commit of commits) {
    const result = await ctx.git.run(
      ["merge-base", "--is-ancestor", sha, commit],
      repoRoot,
    );
    if (result.code === 0) {
      return true;
    }
  }
  return false;
}

/**
 * `temple-bar hook reference-transaction <state>`, fed the hook's stdin.
 * Refuses (exit 1) any update to the protected branch whose new value isn't
 * one of GitHub's commits for it or an ancestor of one; allows everything
 * else.
 */
export async function referenceTransactionCheck(
  state: string,
  stdin: string,
  ctx: Context,
): Promise<number> {
  if (state !== "prepared") {
    return 0;
  }

  const updates = parseRefUpdates(stdin);
  if (!updates.some((update) => update.ref.startsWith("refs/heads/"))) {
    return 0;
  }

  const repoRoot = await findRepoRoot(ctx);
  if (repoRoot === undefined) {
    ctx.stderr.write("temple-bar: could not determine the repository root\n");
    return 1;
  }

  const branch = await findProtectedBranch(ctx, repoRoot);
  const protectedRef = `refs/heads/${branch}`;
  const moves = updates.filter((update) => update.ref === protectedRef);
  if (moves.length === 0) {
    return 0;
  }

  const upstreamRef = upstreamRefFor(branch);
  const onGitHub = await gitHubCommits(ctx, repoRoot, branch, updates);

  for (const update of moves) {
    if (ZERO_OID_PATTERN.test(update.newValue)) {
      ctx.stderr.write(`temple-bar: refusing to delete local ${branch}\n`);
      return 1;
    }

    if (onGitHub.length === 0) {
      ctx.stderr.write(
        `temple-bar: refusing to move local ${branch}: ${upstreamRef} does not exist (fetch first)\n`,
      );
      return 1;
    }

    if (!(await isAncestorOfAny(ctx, repoRoot, update.newValue, onGitHub))) {
      ctx.stderr.write(
        `temple-bar: refusing to move local ${branch} to a commit not on ${upstreamRef} (${update.newValue})\n` +
          "If git left the refused changes in your working tree, keep them " +
          "on a new branch with `git switch -c <name>`, or drop them with " +
          "`git reset --hard`.\n",
      );
      return 1;
    }
  }

  return 0;
}
