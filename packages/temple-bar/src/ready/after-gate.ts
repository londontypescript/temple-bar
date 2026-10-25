// What must still hold once the gate has passed, before a commit is marked
// ready to push. Both `ready` and merge (when it catches a branch up and
// runs the gate itself) mark commits, and both go through here, so neither
// can mark a commit the gate didn't actually judge.
//
// The gate runs the project's own scripts for minutes, and a script can
// commit, or change files on disk. A pass then says nothing about the commit
// being pushed: so the mark goes on the commit the gate was started on, and
// only while it is still checked out and the worktree still matches it.
//
// A failure is returned, never thrown, so each caller stops in its own way.

import type { Context } from "../context.ts";
import { writeMark } from "./mark.ts";

/** Why nothing was marked: HEAD isn't the commit the gate ran on, the
 * worktree has changes, or its status couldn't be read. */
export interface Unmarked {
  readonly problem: "moved" | "changed" | "unreadable";
  /** Says what is wrong, without what to do: that is each caller's. */
  readonly reason: string;
}

const MAX_LISTED = 10;

// The gate reads the files on disk, but a push carries only the commit. A
// change that isn't committed, or a new file that was never added, would be
// judged here and then be missing from what CI sees, so only a worktree that
// matches its commit exactly counts. Ignored files (node_modules, build
// output) don't.
/** Why the worktree at `root` doesn't match its commit, or undefined when
 * it does. */
export async function worktreeChanges(
  ctx: Context,
  root: string,
): Promise<Unmarked | undefined> {
  const result = await ctx.git.run(
    ["status", "--porcelain", "--untracked-files=all"],
    root,
  );
  if (result.code !== 0) {
    return {
      problem: "unreadable",
      reason: `could not read the worktree's status: ${result.stderr.trim()}`,
    };
  }
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  if (lines.length === 0) {
    return undefined;
  }
  const listed = lines.slice(0, MAX_LISTED).map((line) => `  ${line}`);
  if (lines.length > MAX_LISTED) {
    listed.push(`  ...and ${String(lines.length - MAX_LISTED)} more`);
  }
  return {
    problem: "changed",
    reason:
      "the worktree has changes that aren't committed, so the gate would judge files the push won't carry:\n" +
      listed.join("\n"),
  };
}

/** Marks `expected`, the commit the gate was run on, as ready to push in
 * the worktree at `root`, but only if it is still checked out there and the
 * worktree is clean. Returns why not otherwise, having marked nothing. */
export async function markAfterGate(
  ctx: Context,
  root: string,
  expected: string,
): Promise<Unmarked | undefined> {
  const head = await ctx.git.run(
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    root,
  );
  if (head.code !== 0 || head.stdout.trim() !== expected) {
    return {
      problem: "moved",
      reason: "the checked-out commit changed while the gate ran",
    };
  }
  const changes = await worktreeChanges(ctx, root);
  if (changes !== undefined) {
    return changes;
  }
  await writeMark(ctx, root, expected);
  return undefined;
}
