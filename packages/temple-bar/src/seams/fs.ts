// The only place domain code touches the filesystem. Deliberately small and
// missing a delete method: setup never deletes anything, so
// there is no method that would let it.

import { constants, promises as fsp } from "node:fs";
import path from "node:path";

type PathKind = "missing" | "file" | "directory" | "symlink" | "other";

export interface FsSeam {
  /** Classifies the entry itself, never following links. Only ENOENT is missing. */
  classify(path: string): Promise<PathKind>;
  readlink(path: string): Promise<string>;
  /** The path with every symlink, `.` and `..` resolved, the way the
   * operating system names it (on Windows, long names, not 8.3 short ones).
   * Rejects when the path doesn't exist. */
  realpath(path: string): Promise<string>;
  /** Reads a file as UTF-8 text, or returns undefined if it doesn't exist. */
  readText(path: string): Promise<string | undefined>;
  /** True only for an ordinary file. A symlink (to a file, a directory, or
   * nothing), a directory and a missing path are all false: callers that read
   * a repo's own text use this to skip what is not a text file of the repo. */
  isRegularFile(path: string): Promise<boolean>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Creates a directory and any missing parents; a no-op if it exists. */
  mkdirp(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  /** Copies a file, keeping its permissions, but never over an existing
   * one: resolves false, and changes nothing, when `to` already exists. */
  copyNew(from: string, to: string): Promise<boolean>;
  /** Expands a glob pattern from `folder` the way Node's test runner
   * expands its file patterns (braces and `**` included), skipping every
   * `node_modules` folder. Resolves the matching regular files only, never
   * a folder or a link, as "/"-separated paths relative to `folder`;
   * rejects when the disk can't be read. */
  glob(folder: string, pattern: string): Promise<string[]>;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

export function createFsSeam(): FsSeam {
  return {
    async classify(path) {
      try {
        const entry = await fsp.lstat(path);
        if (entry.isSymbolicLink()) return "symlink";
        if (entry.isFile()) return "file";
        if (entry.isDirectory()) return "directory";
        return "other";
      } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT")
          return "missing";
        throw error;
      }
    },
    readlink: (path) => fsp.readlink(path),
    // The promise form resolves the way the native realpath does.
    realpath: (path) => fsp.realpath(path),
    async readText(path) {
      try {
        return await fsp.readFile(path, "utf8");
      } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    },
    async writeText(path, content) {
      await fsp.writeFile(path, content, "utf8");
    },
    async exists(path) {
      try {
        await fsp.access(path);
        return true;
      } catch {
        return false;
      }
    },
    async isRegularFile(path) {
      try {
        return (await fsp.lstat(path)).isFile();
      } catch {
        return false;
      }
    },
    async mkdirp(path) {
      await fsp.mkdir(path, { recursive: true });
    },
    async chmod(path, mode) {
      await fsp.chmod(path, mode);
    },
    async copyNew(from, to) {
      try {
        // COPYFILE_EXCL makes the check and the copy one step, so nothing
        // written in between is overwritten.
        await fsp.copyFile(from, to, constants.COPYFILE_EXCL);
        return true;
      } catch (error) {
        if (isErrnoException(error) && error.code === "EEXIST") {
          return false;
        }
        throw error;
      }
    },
    async glob(folder, pattern) {
      const found: string[] = [];
      for await (const entry of fsp.glob(pattern, {
        cwd: folder,
        withFileTypes: true,
        exclude: (skipped) => skipped.name === "node_modules",
      })) {
        if (entry.isFile()) {
          found.push(
            path
              .relative(folder, path.join(entry.parentPath, entry.name))
              .split(path.sep)
              .join("/"),
          );
        }
      }
      return found;
    },
  };
}
