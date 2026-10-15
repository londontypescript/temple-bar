// Finishing a worktree removal git left half done. On Windows, `git worktree
// remove` deletes the files but not the directory junctions pnpm makes in
// node_modules, and still exits 0, so the folder stays behind holding only
// node_modules. Every workspace worktree has one, since the post-checkout
// hook installs dependencies.
//
// This is the only code in temple-bar that deletes a folder, and only merge
// is handed it: setup never deletes anything. It deletes only the folder git
// was asked to remove, only when it is still the same folder, holds nothing
// but node_modules, and is not a checkout git still knows. Anything else is
// reported for a person to look at, never deleted.

import { promises as fsp } from "node:fs";
import path from "node:path";

/** A folder as found on disk, never following a link at the folder itself. */
export type FolderState =
  | { readonly kind: "missing" }
  | {
      readonly kind: "directory";
      /** The device and inode, so a different folder at the same path is
       * told apart from the one git was asked to remove. */
      readonly identity: string;
      readonly entries: readonly string[];
    }
  /** A link, a file, or anything else that isn't a plain directory. */
  | { readonly kind: "other" }
  /** Looking failed: not the same as missing. */
  | { readonly kind: "unreadable"; readonly message: string };

export interface WorktreeRemover {
  inspect(folder: string): Promise<FolderState>;
  /** Deletes the folder and everything in it. A link inside is removed
   * itself; what it points to is left alone. */
  removeTree(folder: string): Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorktreeRemover(): WorktreeRemover {
  return {
    async inspect(folder) {
      try {
        const stat = await fsp.lstat(folder, { bigint: true });
        if (!stat.isDirectory()) {
          return { kind: "other" };
        }
        return {
          kind: "directory",
          identity: `${String(stat.dev)}:${String(stat.ino)}`,
          entries: await fsp.readdir(folder),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { kind: "missing" };
        }
        return { kind: "unreadable", message: message(error) };
      }
    },
    async removeTree(folder) {
      // Node removes a symlink or junction without going into it.
      await fsp.rm(folder, { recursive: true, maxRetries: 3 });
    },
  };
}

/** Whether `inner` is `outer` or inside it, compared without case on
 * Windows, where paths are case-insensitive. */
function within(outer: string, inner: string): boolean {
  const fold = (p: string) =>
    process.platform === "win32"
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  const relative = path.relative(fold(outer), fold(inner));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * After `git worktree remove` succeeded: confirms the folder is gone, or
 * finishes removing it when all that is left is node_modules. Returns
 * undefined when the folder is gone, or the problem to report.
 *
 * `before` is the folder as it was before git ran; `checkouts` are every
 * other checkout git still lists, the primary one included.
 */
export async function finishRemoval(
  remover: WorktreeRemover,
  folder: string,
  before: FolderState,
  checkouts: readonly string[],
): Promise<string | undefined> {
  const left = (why: string) =>
    `git unregistered the worktree, but the folder remains at ${folder} (${why}). ` +
    "The pull request did merge. Inspect the folder before deleting it.";
  const now = await remover.inspect(folder);
  if (now.kind === "missing") {
    return undefined;
  }
  if (now.kind === "unreadable") {
    return left(`it could not be read: ${now.message}`);
  }
  if (
    now.kind !== "directory" ||
    before.kind !== "directory" ||
    now.identity !== before.identity
  ) {
    return left("it is not the folder git was asked to remove");
  }
  if (now.entries.length !== 1 || now.entries[0] !== "node_modules") {
    return left("it holds more than node_modules");
  }
  if (checkouts.some((checkout) => within(folder, checkout))) {
    return left("another checkout is inside it");
  }
  try {
    await remover.removeTree(folder);
  } catch (error) {
    return left(`removing it failed: ${message(error)}`);
  }
  const after = await remover.inspect(folder);
  return after.kind === "missing"
    ? undefined
    : left("it was still there after removing it");
}
