// The part reports' own way to the disk. A part's report must never replace
// a file that is already there, and the verifier must see every entry in
// its folder exactly as it is (a link or a folder is a refusal, never
// something to follow), which the shared filesystem seam (seams/fs.ts) can't
// say. Kept small and in one place so tests can hand the gate a fake.

import { promises as fsp } from "node:fs";

export type EntryKind = "missing" | "file" | "directory" | "symlink" | "other";

export interface PartFiles {
  /** What is at `path` itself, never following a link. */
  kind(path: string): Promise<EntryKind>;
  /** The names of the direct entries of `folder`. */
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  /** Writes a new file; rejects, changing nothing, when anything is at
   * `path` already. */
  createNew(path: string, text: string): Promise<void>;
}

export function createRealPartFiles(): PartFiles {
  return {
    async kind(path) {
      try {
        const entry = await fsp.lstat(path);
        if (entry.isSymbolicLink()) return "symlink";
        if (entry.isFile()) return "file";
        if (entry.isDirectory()) return "directory";
        return "other";
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return "missing";
        throw error;
      }
    },
    list: (folder) => fsp.readdir(folder),
    read: (path) => fsp.readFile(path, "utf8"),
    async createNew(path, text) {
      // "wx" fails if anything exists at the path, a dangling link included.
      await fsp.writeFile(path, text, { encoding: "utf8", flag: "wx" });
    },
  };
}
