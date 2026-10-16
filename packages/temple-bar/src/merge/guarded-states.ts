// The local reader behind `ready` and `merge`: what a branch changes, and
// each guarded path's state on both sides, read from git the way the judge
// reads GitHub's trees, so all three name the same changes for the same
// diff (see ../judge/changes.ts).
//
// Every read is exact. Paths come NUL-separated and are never trimmed or
// unquoted, so a name git would quote (non-ASCII, a quote, a tab, a
// newline) is still seen as it is. Anything git answers that isn't the one
// entry asked for is unreadable, never absent.

import type { Context } from "../context.ts";
import type { FileState, PathChange } from "../judge/file-state.ts";
import { isGuarded, readsText } from "../judge/guarded-paths.ts";
import { checkEntry, isRegularFile } from "../judge/tree-entry.ts";
import { refuse } from "./refusal.ts";

/** Paths changed between `base` and `head`, compared from where they
 * meet. Renames are listed as both paths, and the options take no default
 * from git's config: `diff.relative` would narrow the list to the current
 * folder, and `diff.ignoreSubmodules` would hide a submodule. */
export async function changedPaths(
  ctx: Context,
  base: string,
  head: string,
  cwd: string,
): Promise<string[]> {
  const result = await ctx.git.run(
    [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--no-relative",
      "--ignore-submodules=none",
      "--no-ext-diff",
      "--no-color",
      `${base}...${head}`,
    ],
    cwd,
  );
  if (result.code !== 0) {
    refuse(
      `could not list the files the pull request changes: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.split("\0").filter((file) => file !== "");
}

function unreadable(reason: string): FileState {
  return { kind: "unreadable", reason };
}

/** The one entry `git ls-tree` gives for `file` at `commit`, checked:
 * `<mode> <type> <id>\t<path>\0`, for exactly the path asked for. */
function parseEntry(output: string, file: string) {
  if (!output.endsWith("\0") || output.indexOf("\0") !== output.length - 1) {
    return undefined;
  }
  const line = output.slice(0, -1);
  const tab = line.indexOf("\t");
  const [mode, type, id, ...rest] = line.slice(0, tab).split(" ");
  if (tab < 0 || rest.length > 0 || line.slice(tab + 1) !== file) {
    return undefined;
  }
  return checkEntry(mode, type, id);
}

/** `file` at `commit`: absent, a regular file (its text read when the
 * comparison needs it), something else, or unreadable. */
export async function stateAt(
  ctx: Context,
  commit: string,
  file: string,
  cwd: string,
): Promise<FileState> {
  const listed = await ctx.git.run(
    ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", commit, "--", file],
    cwd,
  );
  if (listed.code !== 0) {
    return unreadable(`git ls-tree failed: ${listed.stderr.trim()}`);
  }
  if (listed.stdout === "") {
    return { kind: "absent" };
  }
  const entry = parseEntry(listed.stdout, file);
  if (entry === undefined) {
    return unreadable("git ls-tree listed something other than this file");
  }
  if (!isRegularFile(entry)) {
    return { kind: "special", mode: entry.mode };
  }
  if (!readsText(file)) {
    return { kind: "regular", mode: entry.mode };
  }
  const blob = await ctx.git.run(["cat-file", "blob", entry.id], cwd);
  return blob.code === 0
    ? { kind: "regular", mode: entry.mode, text: blob.stdout }
    : unreadable(`git cat-file failed: ${blob.stderr.trim()}`);
}

/** Each guarded path among `paths`, with its state at `base` and `head`. */
export async function readGuardedChanges(
  ctx: Context,
  base: string,
  head: string,
  paths: readonly string[],
  cwd: string,
): Promise<PathChange[]> {
  const changes: PathChange[] = [];
  for (const file of paths.filter(isGuarded)) {
    changes.push({
      path: file,
      base: await stateAt(ctx, base, file, cwd),
      head: await stateAt(ctx, head, file, cwd),
    });
  }
  return changes;
}
