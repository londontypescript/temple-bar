// The file operations both sides of the run need, behind one small interface
// so tests can use a temp folder or a fake, plus removal that survives
// Windows keeping a file locked for a moment after its process ends
// (Defender scans, by choice).

import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";

interface Stat {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface FsLike {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file, or a folder with everything in it. */
  rm(path: string): Promise<void>;
  /** Removes a symbolic link or junction itself, never what it points at. */
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<Stat>;
}

export const nodeFs: FsLike = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  writeFile: (path, data) => writeFile(path, data),
  appendFile: (path, data) => appendFile(path, data),
  readFile: (path) => readFile(path, "utf8"),
  rename,
  rm: (path) => rm(path, { recursive: true, force: true }),
  async unlink(path) {
    try {
      await unlink(path);
    } catch {
      // A directory junction on Windows needs rmdir, which also leaves the
      // target alone.
      await rmdir(path);
    }
  },
  readdir,
  lstat,
};

export async function pathExists(fs: FsLike, path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

const REMOVE_ATTEMPTS = 6;
const FIRST_BACKOFF_MS = 100;

/**
 * Removes `path`, trying again with a growing pause when Windows still has it
 * locked. A link is removed as a link: the folder it points at is never
 * followed or emptied. Throws the last error when every attempt failed.
 */
export async function removeWithRetry(
  fs: FsLike,
  sleep: (ms: number) => Promise<void>,
  path: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
    try {
      let info: Stat | undefined;
      try {
        info = await fs.lstat(path);
      } catch {
        return;
      }
      if (info.isSymbolicLink()) {
        await fs.unlink(path);
      } else {
        await fs.rm(path);
      }
      if (!(await pathExists(fs, path))) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(FIRST_BACKOFF_MS * 2 ** attempt);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`could not remove ${path}`);
}
