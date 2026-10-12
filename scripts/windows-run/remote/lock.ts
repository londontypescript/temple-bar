// A lock folder that is taken whole or not at all. The owner's details are
// written into a private folder first, and that folder is renamed to the lock's
// name: a rename onto a lock that already exists fails, so there is never a
// moment when the lock exists without its owner inside (and so never a lock a
// second run could mistake for stale). The Windows runner uses it, and so does
// the local side, with its own way of asking whether a holder is alive.

import path from "node:path";

import { pathExists, removeWithRetry, type FsLike } from "./fsx.ts";

export interface LockOwner {
  readonly pid: number;
  /** When the owner's process started, in ms, or null if unreadable. */
  readonly startMs: number | null;
  readonly runId: string;
}

export interface LockDeps {
  readonly fs: FsLike;
  readonly sleep: (ms: number) => Promise<void>;
  /** Whether the process an owner file describes is still running. */
  isAlive(owner: LockOwner): Promise<boolean>;
}

export type LockResult =
  | { readonly kind: "acquired"; readonly tookOver: string | undefined }
  | { readonly kind: "held"; readonly holder: LockOwner | undefined };

const OWNER_FILE = "owner.json";

async function readOwner(
  fs: FsLike,
  dir: string,
): Promise<LockOwner | undefined> {
  try {
    const value: unknown = JSON.parse(
      await fs.readFile(path.join(dir, OWNER_FILE)),
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      "startMs" in value &&
      "runId" in value &&
      Number.isSafeInteger(value.pid) &&
      (value.startMs === null || typeof value.startMs === "number") &&
      typeof value.runId === "string"
    ) {
      return value as LockOwner;
    }
  } catch {
    // Missing or unreadable: treated as no owner.
  }
  return undefined;
}

async function tryRename(
  fs: FsLike,
  from: string,
  to: string,
): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    // The only expected failure is the lock already being there. Anything
    // else (a permissions error, say) is not "held" and must be seen.
    if (await pathExists(fs, to)) {
      return false;
    }
    throw error;
  }
}

/**
 * Takes the lock folder `dir` for `self`. A live holder means it is held. A
 * dead holder's lock, or one with no readable owner, is renamed aside and
 * taken over. Runs are serialised from one machine, so a stale lock has no
 * second contender and no protocol is built for one.
 */
export async function acquireLock(
  deps: LockDeps,
  dir: string,
  self: LockOwner,
): Promise<LockResult> {
  const { fs } = deps;
  const mine = `${dir}.${self.runId}`;
  await removeWithRetry(fs, deps.sleep, mine);
  await fs.mkdir(mine);
  try {
    await fs.writeFile(path.join(mine, OWNER_FILE), JSON.stringify(self));
    // A rename onto an empty folder can succeed on some systems, and a lock
    // with no owner file is exactly the empty case, so look first.
    if (!(await pathExists(fs, dir)) && (await tryRename(fs, mine, dir))) {
      return { kind: "acquired", tookOver: undefined };
    }
    const holder = await readOwner(fs, dir);
    if (holder !== undefined && (await deps.isAlive(holder))) {
      return { kind: "held", holder };
    }
    const aside = `${dir}.stale.${self.runId}`;
    await removeWithRetry(fs, deps.sleep, aside);
    await fs.rename(dir, aside);
    const note =
      holder === undefined
        ? "a lock with no readable owner"
        : `the lock of a run that is no longer running (pid ${String(holder.pid)})`;
    if (await tryRename(fs, mine, dir)) {
      await removeWithRetry(fs, deps.sleep, aside).catch(() => undefined);
      return { kind: "acquired", tookOver: note };
    }
    return { kind: "held", holder: await readOwner(fs, dir) };
  } finally {
    await removeWithRetry(fs, deps.sleep, mine).catch(() => undefined);
  }
}

/** Releases the lock only if its owner file names this run: a run never
 * removes another's lock. Returns whether it removed one. */
export async function releaseLock(
  deps: LockDeps,
  dir: string,
  runId: string,
): Promise<boolean> {
  const holder = await readOwner(deps.fs, dir);
  if (holder?.runId !== runId) {
    return false;
  }
  await removeWithRetry(deps.fs, deps.sleep, dir);
  return true;
}
