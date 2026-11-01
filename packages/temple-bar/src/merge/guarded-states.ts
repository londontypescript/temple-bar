// The local reader behind `ready` and `merge`: what a branch changes, and
// each guarded path's state on both sides, read from git the way the judge
// reads GitHub's trees, so all three name the same changes for the same
// diff (see ../judge/changes.ts).
//
// Every read is exact. Paths come NUL-separated and are never trimmed or
// unquoted, so a name git would quote (non-ASCII, a quote, a tab, a
// newline) is still seen as it is. Anything git answers that isn't the one
// entry asked for is unreadable, never absent. Trees are listed with
// replacement objects off: a local `refs/replace/` could otherwise show
// `ready` and `merge` another tree than the one GitHub's judge reads.

import type { Context } from "../context.ts";
import { isTextOfBlob, NOT_UTF8 } from "../judge/blob-text.ts";
import { headFacts } from "../judge/catalog-facts.ts";
import type {
  CatalogContext,
  FileState,
  PathChange,
} from "../judge/file-state.ts";
import {
  isGuarded,
  isWorkflowFolder,
  readsText,
  WORKSPACE_FILE,
} from "../judge/guarded-paths.ts";
import {
  checkEntry,
  isRegularFile,
  isTreePath,
  type TreeEntry,
} from "../judge/tree-entry.ts";
import { refuse } from "./refusal.ts";

/** Before the subcommand: git reads each object as it is stored, never as
 * a replacement ref would have it. */
const NO_REPLACE = "--no-replace-objects";

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

/** An entry as the comparison sees it: absent, a regular file (its text
 * read when the comparison needs it), something else, or unreadable. The
 * text is read by the blob's id, and must encode back to that same blob:
 * git's seam decodes what it reads, and bytes that aren't UTF-8 don't
 * survive that, so the text would no longer be the file's. */
async function stateOfEntry(
  ctx: Context,
  file: string,
  entry: TreeEntry | undefined,
  cwd: string,
): Promise<FileState> {
  if (entry === undefined || isWorkflowFolder(file, entry)) {
    return { kind: "absent" };
  }
  if (!isRegularFile(entry)) {
    return { kind: "special", mode: entry.mode };
  }
  if (!readsText(file)) {
    return { kind: "regular", mode: entry.mode };
  }
  const blob = await ctx.git.run(["cat-file", "blob", entry.id], cwd);
  if (blob.code !== 0) {
    return unreadable(`git cat-file failed: ${blob.stderr.trim()}`);
  }
  return isTextOfBlob(blob.stdout, entry.id)
    ? { kind: "regular", mode: entry.mode, text: blob.stdout }
    : unreadable(NOT_UTF8);
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
    [
      NO_REPLACE,
      "--literal-pathspecs",
      "ls-tree",
      "-z",
      "--full-tree",
      commit,
      "--",
      file,
    ],
    cwd,
  );
  if (listed.code !== 0) {
    return unreadable(`git ls-tree failed: ${listed.stderr.trim()}`);
  }
  if (listed.stdout === "") {
    return { kind: "absent" };
  }
  const entry = parseEntry(listed.stdout, file);
  return entry === undefined
    ? unreadable("git ls-tree listed something other than this file")
    : stateOfEntry(ctx, file, entry, cwd);
}

/** `commit`'s whole tree, files and folders at every depth, by path, as
 * the judge reads GitHub's recursive trees. A listing that can't be read
 * whole is refused, never skipped, and so is one naming a path twice: two
 * names whose bytes differ can come back from the seam as one string. */
async function listTree(
  ctx: Context,
  commit: string,
  cwd: string,
): Promise<Map<string, TreeEntry>> {
  const listed = await ctx.git.run(
    [NO_REPLACE, "ls-tree", "-r", "-t", "-z", "--full-tree", commit],
    cwd,
  );
  const lines = listed.stdout.split("\0");
  // git ends every entry with a NUL, so the last part is always "".
  if (listed.code !== 0 || lines.pop() !== "") {
    refuse(
      `could not list the files at ${commit}: ${listed.stderr.trim() || "git ls-tree answered nothing"}`,
    );
  }
  const tree = new Map<string, TreeEntry>();
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) {
      refuse(
        `could not list the files at ${commit}: git ls-tree listed "${line}"`,
      );
    }
    if (tree.has(parsed.path)) {
      refuse(
        `could not list the files at ${commit}: git ls-tree lists ${parsed.path} twice`,
      );
    }
    tree.set(parsed.path, parsed.entry);
  }
  return tree;
}

/** A path's entry in a listing, with a folder under .github/workflows/
 * treated as not there, as the judge treats it. */
function seen(
  tree: ReadonlyMap<string, TreeEntry>,
  file: string,
): TreeEntry | undefined {
  const entry = tree.get(file);
  return entry === undefined || isWorkflowFolder(file, entry)
    ? undefined
    : entry;
}

/** Whether the comparison judges a guarded path, as the judge decides it
 * from GitHub's trees: its entry differs between the two listings, or the
 * head has it as something other than a regular file, changed or not. A
 * diff lists only files, so a folder named package.json shows up only in
 * the listings. */
function judged(
  before: TreeEntry | undefined,
  after: TreeEntry | undefined,
): boolean {
  return (
    before?.mode !== after?.mode ||
    before?.id !== after?.id ||
    (after !== undefined && !isRegularFile(after))
  );
}

/** The facts about the head that decide whether a change to the root
 * pnpm-workspace.yaml's catalog is inert, from the head's listing. The
 * root package.json is read by the id the listing gives, never by its
 * path again. */
async function catalogContext(
  ctx: Context,
  head: ReadonlyMap<string, TreeEntry>,
  cwd: string,
): Promise<CatalogContext> {
  const { rootManifest, ...facts } = headFacts(head);
  return {
    ...facts,
    rootManifest: await stateOfEntry(ctx, "package.json", rootManifest, cwd),
  };
}

/** Each guarded path among `paths`, and each the comparison judges from
 * both listings, with its state at `base` and `head`. Each state comes from the
 * listing's own entry, never from asking git for the path again: a path
 * whose bytes aren't UTF-8 comes back from the seam altered, and asking
 * for it by that altered name would find nothing. */
export async function readGuardedChanges(
  ctx: Context,
  base: string,
  head: string,
  paths: readonly string[],
  cwd: string,
): Promise<PathChange[]> {
  const baseTree = await listTree(ctx, base, cwd);
  const headTree = await listTree(ctx, head, cwd);
  const listed = [...new Set([...baseTree.keys(), ...headTree.keys()])].filter(
    (file) => judged(seen(baseTree, file), seen(headTree, file)),
  );
  const files = [...new Set([...paths, ...listed])].filter(isGuarded);
  const context = files.includes(WORKSPACE_FILE)
    ? await catalogContext(ctx, headTree, cwd)
    : undefined;
  const changes: PathChange[] = [];
  for (const file of files) {
    const change = {
      path: file,
      base: await stateOfEntry(ctx, file, seen(baseTree, file), cwd),
      head: await stateOfEntry(ctx, file, seen(headTree, file), cwd),
    };
    changes.push(
      file === WORKSPACE_FILE && context !== undefined
        ? { ...change, catalogContext: context }
        : change,
    );
  }
  return changes;
}
