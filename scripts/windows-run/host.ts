// Which Windows machine to use. The SSH destination is kept in the primary
// checkout's gitignored .temple-bar folder, never in the repo, so every
// worktree of this checkout shares one setting and nothing about the machine
// is ever committed.

import path from "node:path";

import { pathExists, type FsLike } from "./remote/fsx.ts";

const HOST_PART = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export const SET_HOST_COMMAND = "pnpm windows-run --host <ssh-destination>";

/**
 * An SSH alias or hostname, optionally with `user@`, each part only letters,
 * digits, dots, underscores and hyphens and not starting with a hyphen (which
 * ssh would read as an option). No ports, paths, colons, IPv6 literals or
 * URIs: a port belongs in ~/.ssh/config. Checked for a typed value and a saved
 * one alike.
 */
export function isValidHost(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parts = value.split("@");
  return (
    parts.length <= 2 &&
    parts.every((part) => HOST_PART.test(part)) &&
    value.length <= 255
  );
}

export type PrimaryResult =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: string };

/** The first entry of `git worktree list --porcelain`, the way temple-bar's
 * own post-checkout hook finds it. A bare repository has no checkout. */
export async function findPrimary(
  listing: { code: number; stdout: string },
  fs: FsLike,
): Promise<PrimaryResult> {
  if (listing.code !== 0) {
    return { ok: false, reason: "this is not inside a git checkout" };
  }
  const [first = ""] = listing.stdout.split(/\r?\n\r?\n/);
  const lines = first.split(/\r?\n/);
  const worktreeLine = lines.find((line) => line.startsWith("worktree "));
  if (worktreeLine === undefined || lines.includes("bare")) {
    return {
      ok: false,
      reason: "the repository is bare, so it has no checkout",
    };
  }
  const dir = worktreeLine.slice("worktree ".length);
  let isFolder: boolean;
  try {
    isFolder = (await fs.lstat(dir)).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder || !(await pathExists(fs, path.join(dir, ".git")))) {
    return {
      ok: false,
      reason: "the first worktree git lists is not a folder holding a checkout",
    };
  }
  return { ok: true, dir };
}

export function hostFile(primary: string): string {
  return path.join(primary, ".temple-bar", "windows-run.json");
}

export type SavedHost =
  | { readonly kind: "none" }
  | { readonly kind: "host"; readonly host: string }
  | { readonly kind: "bad"; readonly why: string };

export async function readSavedHost(
  fs: FsLike,
  primary: string,
): Promise<SavedHost> {
  const file = hostFile(primary);
  if (!(await pathExists(fs, file))) {
    return { kind: "none" };
  }
  try {
    const value: unknown = JSON.parse(await fs.readFile(file));
    const host =
      typeof value === "object" && value !== null && "host" in value
        ? value.host
        : undefined;
    return isValidHost(host)
      ? { kind: "host", host }
      : { kind: "bad", why: "it does not hold a valid SSH destination" };
  } catch {
    return { kind: "bad", why: "it could not be read as JSON" };
  }
}

/** Writes a temp file then renames it, so a crash never leaves half a file. */
export async function saveHost(
  fs: FsLike,
  primary: string,
  host: string,
  tag: string,
): Promise<void> {
  const file = hostFile(primary);
  const temp = `${file}.${tag}.tmp`;
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(temp, `${JSON.stringify({ host }, null, 2)}\n`);
  await fs.rename(temp, file);
}
