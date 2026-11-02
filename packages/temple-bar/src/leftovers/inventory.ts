// What is in a worktree, as git lists it, and what in it could make
// removing the folder delete more than the worktree: another repository or
// worktree, a mounted folder, or (on Windows) a link leading outside. Also
// the checksums of the ignored files a release certifies. git's lists are
// read NUL-delimited and whole, and links are never followed: an entry is
// looked at with lstat, and a link's target only read as text.

import { createHash } from "node:crypto";
import path from "node:path";

import type { Context } from "../context.ts";
import { firstFew, foldersOnTheWay, isInside, splitNul } from "./paths.ts";

export interface Inventory {
  readonly tracked: readonly string[];
  readonly untracked: readonly string[];
  readonly ignored: readonly string[];
}

/** Folders whose contents are dependencies or build output: disposable
 * whenever written, and too many to hash, so a release doesn't watch them. */
const UNWATCHED = new Set(["node_modules", "dist", "coverage"]);
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** Well under Windows' command-line limit, with room for git's own args. */
const BATCH_CHARACTERS = 8000;
const PARALLEL = 64;

async function listFiles(
  ctx: Context,
  worktree: string,
  args: readonly string[],
): Promise<string[] | string> {
  const result = await ctx.git.run(["ls-files", "-z", ...args], worktree);
  // git warns, and still exits 0, when it can't open a folder: the list is
  // then incomplete, so it counts as unread.
  if (result.code !== 0 || result.stderr !== "") {
    const said = result.stderr.split("\n")[0] ?? "";
    return `git couldn't list its files${said === "" ? "" : ` (${said})`}`;
  }
  return splitNul(result.stdout) ?? "git's list of its files was cut short";
}

/** Tracked, untracked and ignored paths. Without `--directory`, git
 * descends ignored folders such as node_modules and lists each nested
 * repository as one entry ending in "/". */
export async function readInventory(
  ctx: Context,
  worktree: string,
): Promise<Inventory | string> {
  const tracked = await listFiles(ctx, worktree, []);
  const untracked = await listFiles(ctx, worktree, [
    "--others",
    "--exclude-standard",
  ]);
  const ignored = await listFiles(ctx, worktree, [
    "--others",
    "--ignored",
    "--exclude-standard",
  ]);
  for (const list of [tracked, untracked, ignored]) {
    if (typeof list === "string") {
      return list;
    }
  }
  return {
    tracked: tracked as string[],
    untracked: untracked as string[],
    ignored: ignored as string[],
  };
}

export function allPaths(inventory: Inventory): string[] {
  return [...inventory.tracked, ...inventory.untracked, ...inventory.ignored];
}

/** Nested repositories and anything named `.git`, from git's lists. */
export function nestedRepositories(inventory: Inventory): string[] {
  const problems: string[] = [];
  const nested = allPaths(inventory).filter((entry) => entry.endsWith("/"));
  if (nested.length > 0) {
    problems.push(`a repository inside it: ${firstFew(nested)}`);
  }
  // Compared without case: on a case-insensitive disk `.GIT` is `.git`.
  const named = allPaths(inventory).filter((entry) =>
    entry.split("/").some((part) => part.toLowerCase() === ".git"),
  );
  if (named.length > 0) {
    problems.push(`a path named .git inside it: ${firstFew(named)}`);
  }
  return problems;
}

/** A bare repository has no `.git` for git to notice: its shape is a file
 * named HEAD beside an `objects` folder. Its HEAD can be tracked while its
 * objects are ignored, so every list is searched. */
export async function bareRepositories(
  ctx: Context,
  worktree: string,
  inventory: Inventory,
): Promise<string[]> {
  const folders = new Set<string>();
  for (const entry of allPaths(inventory)) {
    const parts = entry.split("/");
    if (parts.at(-1)?.toLowerCase() === "head") {
      folders.add(parts.slice(0, -1).join("/"));
    }
  }
  const found: string[] = [];
  for (const folder of folders) {
    const kind = await ctx.fs
      .classify(path.join(worktree, folder, "objects"))
      .catch(() => "unreadable");
    if (kind !== "missing" && kind !== "file") {
      found.push(folder === "" ? "." : folder);
    }
  }
  return found.length > 0
    ? [`a bare repository inside it: ${firstFew(found)}`]
    : [];
}

async function inBatches<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    results.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(run))));
  }
  return results;
}

/** Every folder on the way to a listed path, without duplicates. */
function folders(inventory: Inventory): string[] {
  const all = new Set<string>();
  for (const entry of allPaths(inventory)) {
    const whole = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    for (const folder of foldersOnTheWay(whole)) {
      all.add(folder);
    }
  }
  return [...all];
}

/** A folder on another filesystem has another device number; removing
 * the worktree would delete what is mounted there. Each folder on the way
 * to each listed path is compared with the worktree's own folder. A mount
 * holding only empty folders lists no path, so it can't be seen (ADR 0022
 * names that limit). */
export async function mountedFolders(
  ctx: Context,
  worktree: string,
  inventory: Inventory,
): Promise<string[]> {
  const own = await ctx.fs.deviceId(worktree).catch(() => undefined);
  if (own === undefined) {
    return ["its folder's device can't be read"];
  }
  const checked = await inBatches(folders(inventory), async (folder) => ({
    folder,
    device: await ctx.fs
      .deviceId(path.join(worktree, folder))
      .catch(() => "unreadable" as const),
  }));
  const mounted = checked
    .filter(({ device }) => typeof device === "bigint" && device !== own)
    .map(({ folder }) => folder);
  const unknown = checked
    .filter(({ device }) => typeof device !== "bigint")
    .map(({ folder }) => folder);
  return [
    ...(mounted.length > 0
      ? [`a mounted folder inside it: ${firstFew(mounted)}`]
      : []),
    ...(unknown.length > 0
      ? [`can't tell whether these are mounted folders: ${firstFew(unknown)}`]
      : []),
  ];
}

/** On Windows a volume mount point is the same kind of reparse point as a
 * junction, so lstat can't tell them apart. Any link or junction met, as a
 * listed entry or a folder on the way to one, whose target is outside the
 * worktree keeps it. pnpm's own junctions point inside node_modules or at
 * workspace packages, so they pass. */
export async function linksLeadingOutside(
  ctx: Context,
  root: string,
  /** The worktree's folder as git lists it and as the disk resolves it. */
  insideOf: readonly string[],
  inventory: Inventory,
): Promise<string[]> {
  const entries = [...folders(inventory), ...allPaths(inventory)];
  const outside = await inBatches(entries, async (entry) => {
    const at = path.join(root, entry);
    try {
      if ((await ctx.fs.classify(at)) !== "symlink") {
        return undefined;
      }
      const target = (await ctx.fs.readlink(at)).replace(/^\\\\\?\\/, "");
      const resolved = path.resolve(path.dirname(at), target);
      return insideOf.some((folder) => isInside(resolved, folder))
        ? undefined
        : entry;
    } catch {
      return entry;
    }
  });
  const found = outside.filter((entry) => entry !== undefined);
  return found.length > 0
    ? [`a link or junction leading outside it: ${firstFew(found)}`]
    : [];
}

/** Ignored entries a release watches: everything but what is under a
 * node_modules, dist or coverage folder, at any depth. */
function watched(entry: string): boolean {
  return !foldersOnTheWay(entry).some((folder) =>
    UNWATCHED.has(folder.split("/").at(-1) ?? ""),
  );
}

function linkId(target: string): string {
  return createHash("sha256").update(target, "utf8").digest("hex");
}

/** The path and checksum of each watched ignored entry: a file's from
 * `git hash-object --no-filters`, without -w, so its raw bytes are hashed
 * (no clean filter or line-ending conversion) and never stored; a link's
 * from its target's text, never followed. Any other kind, or one that
 * can't be read, is a reason instead. */
export async function checksums(
  ctx: Context,
  worktree: string,
  ignored: readonly string[],
): Promise<Map<string, string> | string> {
  const files = new Map<string, string>();
  const toHash: string[] = [];
  // A nested repository ("x/") is never certified: it keeps the worktree
  // on its own, wherever it is.
  for (const entry of ignored.filter(
    (entry) => watched(entry) && !entry.endsWith("/"),
  )) {
    const at = path.join(worktree, entry);
    const kind = await ctx.fs.classify(at).catch(() => "unreadable");
    if (kind === "file") {
      toHash.push(entry);
    } else if (kind === "symlink") {
      const target = await ctx.fs.readlink(at).catch(() => undefined);
      if (target === undefined) {
        return `the link ${JSON.stringify(entry)} can't be read`;
      }
      files.set(entry, `link:${linkId(target)}`);
    } else {
      const what =
        kind === "missing"
          ? "gone before it could be read"
          : kind === "unreadable"
            ? "unreadable"
            : `a ${kind} entry, not a file or a link`;
      return `${JSON.stringify(entry)} is ${what}`;
    }
  }
  let batch: string[] = [];
  let length = 0;
  const flush = async (): Promise<string | undefined> => {
    if (batch.length === 0) {
      return undefined;
    }
    const result = await ctx.git.run(
      ["hash-object", "--no-filters", "--", ...batch],
      worktree,
    );
    const ids = result.stdout.split("\n").slice(0, -1);
    if (
      result.code !== 0 ||
      ids.length !== batch.length ||
      !ids.every((id) => OBJECT_ID.test(id))
    ) {
      return "git couldn't checksum its ignored files";
    }
    batch.forEach((entry, i) => files.set(entry, `file:${ids[i] ?? ""}`));
    batch = [];
    length = 0;
    return undefined;
  };
  for (const entry of toHash) {
    if (length + entry.length > BATCH_CHARACTERS) {
      const failed = await flush();
      if (failed !== undefined) {
        return failed;
      }
    }
    batch.push(entry);
    length += entry.length + 1;
  }
  return (await flush()) ?? files;
}
