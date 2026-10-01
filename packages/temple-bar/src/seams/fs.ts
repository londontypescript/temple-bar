// The only place domain code touches the filesystem. Deliberately small and
// missing a delete method: setup (1.7) never deletes anything (N6/N9), so
// there is no method that would let it.

import { constants, promises as fsp } from "node:fs";

export interface FsSeam {
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
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

export function createFsSeam(): FsSeam {
  return {
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
  };
}
