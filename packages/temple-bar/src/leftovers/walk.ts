// Finds every entry named `.git`, in any case, by walking the worktree's
// folders on disk. git lists nothing under a `.git` folder unless it is a
// valid repository, so a broken clone (its `.git` missing HEAD), a bare
// repository kept inside a plain `.git` folder, or a note written into one
// is invisible to every list git gives, yet removing the worktree would
// delete it. The walk never follows a link, and doesn't enter a folder on
// another device, but reports it as a mounted folder: git lists nothing
// through a mount that holds only what git can't see.

import path from "node:path";

import type { Context } from "../context.ts";
import { firstFew, undecodable } from "./paths.ts";

/** Folders read at once, so a large node_modules doesn't take long. */
const PARALLEL = 64;

export interface Found {
  readonly gitEntries: string[];
  /** Folders the walk couldn't read or look at: anything could be there. */
  readonly unread: string[];
  /** Folders on another device, which the walk doesn't enter. */
  readonly mounted: string[];
}

/** Reads one folder; resolves the subfolders to walk next. */
async function visit(
  ctx: Context,
  root: string,
  own: bigint,
  folder: string,
  found: Found,
): Promise<string[]> {
  const entries = await ctx.fs
    .readdir(folder === "" ? root : path.join(root, folder))
    .catch(() => undefined);
  if (entries === undefined) {
    found.unread.push(folder === "" ? "." : folder);
    return [];
  }
  const next: string[] = [];
  for (const entry of entries) {
    const child = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (undecodable(entry.name)) {
      found.unread.push(child);
    } else if (entry.name.toLowerCase() === ".git") {
      // The worktree's own `.git` is the file at its top pointing at git's
      // record of it; any other is something git can't see past.
      if (folder !== "" || entry.name !== ".git" || entry.kind !== "file") {
        found.gitEntries.push(child);
      }
    } else if (entry.kind === "directory") {
      const device = await ctx.fs
        .deviceId(path.join(root, child))
        .catch(() => undefined);
      if (device === undefined) {
        found.unread.push(child);
      } else if (device === own) {
        next.push(child);
      } else {
        found.mounted.push(child);
      }
    }
  }
  return next;
}

/** Walks the worktree: every `.git` entry in it but its own, every folder
 * it couldn't read, and every mounted folder it met. */
export async function walkWorktree(ctx: Context, root: string): Promise<Found> {
  const own = await ctx.fs.deviceId(root).catch(() => undefined);
  const found: Found = { gitEntries: [], unread: [], mounted: [] };
  if (own === undefined) {
    found.unread.push(".");
  } else {
    let level = [""];
    while (level.length > 0) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += PARALLEL) {
        const batch = level.slice(i, i + PARALLEL);
        for (const folders of await Promise.all(
          batch.map((folder) => visit(ctx, root, own, folder, found)),
        )) {
          next.push(...folders);
        }
      }
      level = next;
    }
  }
  return found;
}

/** Why the walk keeps the worktree, mounts aside (the mount reason merges
 * them with the mount check's). */
export function walkReasons(found: Found): string[] {
  return [
    ...(found.gitEntries.length > 0
      ? [
          `a .git entry inside it, which hides what is under it from git: ${firstFew(found.gitEntries.sort())}`,
        ]
      : []),
    ...(found.unread.length > 0
      ? [`folders that can't be walked: ${firstFew(found.unread.sort())}`]
      : []),
  ];
}
