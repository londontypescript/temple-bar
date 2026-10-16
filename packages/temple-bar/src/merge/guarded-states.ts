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
import {
  isGuarded,
  isWorkflowFolder,
  readsText,
} from "../judge/guarded-paths.ts";
import { checkEntry, isRegularFile, isTreePath } from "../judge/tree-entry.ts";
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

/** One line of `git ls-tree -z`: `<mode> <type> <id>\t<path>`, checked,
 * or undefined when it isn't that shape or names a path no tree holds. */
function parseLine(line: string) {
  const tab = line.indexOf("\t");
  const [mode, type, id, ...rest] = line.slice(0, tab).split(" ");
  const path = line.slice(tab + 1);
  const entry = checkEntry(mode, type, id);
  return tab < 0 || rest.length > 0 || entry === undefined || !isTreePath(path)
    ? undefined
    : { path, entry };
}

/** The one entry `git ls-tree` gives for `file` at `commit`, checked:
 * `<mode> <type> <id>\t<path>\0`, for exactly the path asked for. */
function parseEntry(output: string, file: string) {
  // git ends every entry with a NUL, so one entry splits into it and "".
  const [line, end, ...more] = output.split("\0");
  if (line === undefined || end !== "" || more.length > 0) {
    return undefined;
  }
  const parsed = parseLine(line);
  return parsed?.path === file ? parsed.entry : undefined;
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
  if (isWorkflowFolder(file, entry)) {
    return { kind: "absent" };
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

/** Every guarded path in `commit`'s whole tree that isn't a regular file,
 * as the judge finds them in GitHub's recursive trees. A
 * diff lists only files, so a folder named package.json shows up only
 * here. A listing that can't be read whole is refused, never skipped. */
async function nonRegularGuardedPaths(
  ctx: Context,
  commit: string,
  cwd: string,
): Promise<string[]> {
  const listed = await ctx.git.run(
    ["ls-tree", "-r", "-t", "-z", "--full-tree", commit],
    cwd,
  );
  const lines = listed.stdout.split("\0");
  // git ends every entry with a NUL, so the last part is always "".
  if (listed.code !== 0 || lines.pop() !== "") {
    refuse(
      `could not list the files at ${commit}: ${listed.stderr.trim() || "git ls-tree answered nothing"}`,
    );
  }
  const found: string[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) {
      refuse(
        `could not list the files at ${commit}: git ls-tree listed "${line}"`,
      );
    }
    if (
      isGuarded(parsed.path) &&
      !isRegularFile(parsed.entry) &&
      !isWorkflowFolder(parsed.path, parsed.entry)
    ) {
      found.push(parsed.path);
    }
  }
  return found;
}

/** Each guarded path among `paths`, and each guarded path that isn't a
 * regular file at `base` or `head`, with its state at `base` and `head`. */
export async function readGuardedChanges(
  ctx: Context,
  base: string,
  head: string,
  paths: readonly string[],
  cwd: string,
): Promise<PathChange[]> {
  const files = new Set(paths.filter(isGuarded));
  // Both sides: a folder at a guarded path that the head deletes shows in
  // the diff only as the files inside it, which aren't guarded.
  for (const commit of [base, head]) {
    for (const file of await nonRegularGuardedPaths(ctx, commit, cwd)) {
      files.add(file);
    }
  }
  const changes: PathChange[] = [];
  for (const file of files) {
    changes.push({
      path: file,
      base: await stateAt(ctx, base, file, cwd),
      head: await stateAt(ctx, head, file, cwd),
    });
  }
  return changes;
}
