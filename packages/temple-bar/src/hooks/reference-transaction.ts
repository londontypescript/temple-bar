// Logic behind `temple-bar hook reference-transaction <state>`. Local `main`
// may only move to `refs/remotes/origin/main` or one of its ancestors
// (decision 4 / decision 16's P3.4 check). Deleting `main` is refused, and
// so is every update to `main` when `refs/remotes/origin/main` doesn't exist
// at all, since there is then nothing safe to compare against.
//
// Only the "prepared" state does anything; the shim (shims.ts) already
// filters this before starting Node, but the command re-checks it so calling
// this directly (as the test entry point does) behaves the same way.

import type { Context } from "../context.ts";

interface RefUpdate {
  readonly oldValue: string;
  readonly newValue: string;
  readonly ref: string;
}

const MAIN_REF = "refs/heads/main";
const UPSTREAM_REF = "refs/remotes/origin/main";
const ZERO_OID_PATTERN = /^0+$/;

/**
 * Parses reference-transaction stdin: one `<old-value> <new-value> <ref>`
 * line per updated ref (git's documented format). Blank lines and malformed
 * lines are skipped rather than treated as errors, since a shell pipeline
 * upstream of this may add a trailing blank line.
 */
export function parseRefUpdates(stdin: string): RefUpdate[] {
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

async function upstreamMainExists(
  ctx: Context,
  repoRoot: string,
): Promise<boolean> {
  const result = await ctx.git.run(
    ["rev-parse", "--verify", "--quiet", UPSTREAM_REF],
    repoRoot,
  );
  return result.code === 0;
}

async function isAncestorOfUpstream(
  ctx: Context,
  repoRoot: string,
  sha: string,
): Promise<boolean> {
  const result = await ctx.git.run(
    ["merge-base", "--is-ancestor", sha, UPSTREAM_REF],
    repoRoot,
  );
  return result.code === 0;
}

/**
 * `temple-bar hook reference-transaction <state>`, fed the hook's stdin.
 * Refuses (exit 1) any update to `refs/heads/main` whose new value isn't
 * `refs/remotes/origin/main` or an ancestor of it; allows everything else.
 */
export async function referenceTransactionCheck(
  state: string,
  stdin: string,
  ctx: Context,
): Promise<number> {
  if (state !== "prepared") {
    return 0;
  }

  const mainUpdates = parseRefUpdates(stdin).filter(
    (update) => update.ref === MAIN_REF,
  );
  if (mainUpdates.length === 0) {
    return 0;
  }

  const repoRoot = await findRepoRoot(ctx);
  if (repoRoot === undefined) {
    ctx.stderr.write("temple-bar: could not determine the repository root\n");
    return 1;
  }

  const upstreamExists = await upstreamMainExists(ctx, repoRoot);

  for (const update of mainUpdates) {
    if (ZERO_OID_PATTERN.test(update.newValue)) {
      ctx.stderr.write("temple-bar: refusing to delete local main\n");
      return 1;
    }

    if (!upstreamExists) {
      ctx.stderr.write(
        `temple-bar: refusing to move local main: ${UPSTREAM_REF} does not exist (fetch first)\n`,
      );
      return 1;
    }

    if (!(await isAncestorOfUpstream(ctx, repoRoot, update.newValue))) {
      ctx.stderr.write(
        `temple-bar: refusing to move local main to a commit not on ${UPSTREAM_REF} (${update.newValue})\n`,
      );
      return 1;
    }
  }

  return 0;
}
