// Deleting origin's copy of a branch, shared by `temple-bar merge` and
// `temple-bar leftovers --remove`: one lease, read one way. The lease is the
// check: git sends the deletion with the commit it expects, and origin
// refuses it if the branch has moved, so there is no gap between a check and
// the delete. What each command does before the push differs on purpose
// (merge pushes even when it couldn't read the tip, having just seen GitHub
// merge that head; leftovers pushes only once it has read the tip as exactly
// the head), so that stays with the callers.

import type { Context } from "../context.ts";

/** origin's branch as `ls-remote` reads it. */
export type RemoteTip =
  | { readonly kind: "at"; readonly tip: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" };

export async function readRemoteTip(
  ctx: Context,
  branch: string,
  cwd: string,
): Promise<RemoteTip> {
  const ref = `refs/heads/${branch}`;
  const result = await ctx.git.run(
    ["ls-remote", "--heads", "origin", ref],
    cwd,
  );
  if (result.code !== 0) {
    return { kind: "unreadable" };
  }
  // Ref names hold no tab or newline, so each line is "<tip>\t<ref>". The
  // pattern matches by its end, so only the exact full name counts.
  for (const line of result.stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0 && line.slice(tab + 1) === ref) {
      return { kind: "at", tip: line.slice(0, tab) };
    }
  }
  return { kind: "absent" };
}

export interface LeaseResult {
  /** What was done, for the report. */
  readonly done?: string;
  /** What was left, with what to do about it. */
  readonly problem?: string;
}

/** Pushes the deletion of origin's `branch` under a lease on `head`, and
 * says what happened. Only git's "stale info" rejection says the tip wasn't
 * the head; any other failure (a rule, a permission, the server) says
 * nothing about the tip, so the tip is read again only to explain it, never
 * to try again. */
export async function deleteUnderLease(
  ctx: Context,
  branch: string,
  head: string,
  cwd: string,
): Promise<LeaseResult> {
  const ref = `refs/heads/${branch}`;
  const pushed = await ctx.git.run(
    ["push", `--force-with-lease=${ref}:${head}`, "origin", `:${ref}`],
    cwd,
  );
  if (pushed.code === 0) {
    return {
      done: `deleted origin/${branch}, whose tip was still the merged ${head}`,
    };
  }
  const stderr = pushed.stderr.trim();
  const stale = stderr.includes("(stale info)");
  const now = await readRemoteTip(ctx, branch, cwd);
  if (now.kind === "absent") {
    return { done: `confirmed origin/${branch} is gone` };
  }
  if (now.kind === "at" && now.tip !== head) {
    return {
      problem:
        `kept origin/${branch}: its tip is ${now.tip}, not the merged ${head}, so it holds work that didn't merge. ` +
        "Look at it before deleting it.",
    };
  }
  const why = stale
    ? `git refused to delete it because it was no longer at the merged ${head} when it pushed`
    : "the push failed";
  const tip =
    now.kind === "at"
      ? `its tip now reads as the merged ${head}`
      : "its tip could not be read afterwards, so look at it before deleting it";
  return {
    problem: `could not delete origin/${branch}: ${why}, and ${tip}. git said: ${stderr}`,
  };
}
