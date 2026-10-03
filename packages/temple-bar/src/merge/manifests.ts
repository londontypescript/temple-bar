// What a pull request changes, read once from git and shared by everything
// that judges it before the merge: the files it touches, and each
// package.json it touches, parsed as it was before and after. Reading the
// manifests here, rather than in each caller, means the maintainer-approval
// check and the "what you are approving" report can't disagree.

import path from "node:path";

import type { Context } from "../context.ts";
import { changedFiles, fileAt } from "./local.ts";

export type Manifest = Readonly<Record<string, unknown>>;

export interface ManifestChange {
  /** Repository-relative, e.g. "package.json" or "packages/x/package.json". */
  readonly path: string;
  /** Undefined when the file didn't exist on that side, or didn't parse. */
  readonly before: Manifest | undefined;
  readonly after: Manifest | undefined;
}

export interface PullRequestChanges {
  readonly files: readonly string[];
  readonly manifests: readonly ManifestChange[];
}

function parse(text: string | undefined): Manifest | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Manifest)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The files and package.json files changed between where the pull request
 * branched off (`base`) and its tip (`head`). */
export async function readChanges(
  ctx: Context,
  base: string,
  head: string,
  cwd: string,
): Promise<PullRequestChanges> {
  const files = await changedFiles(ctx, base, head, cwd);
  const manifests: ManifestChange[] = [];
  for (const file of files) {
    if (path.posix.basename(file) !== "package.json") {
      continue;
    }
    manifests.push({
      path: file,
      before: parse(await fileAt(ctx, base, file, cwd)),
      after: parse(await fileAt(ctx, head, file, cwd)),
    });
  }
  return { files, manifests };
}

/** The repository's root package.json change, if it has one. */
export function rootManifest(
  changes: PullRequestChanges,
): ManifestChange | undefined {
  return changes.manifests.find((manifest) => manifest.path === "package.json");
}

/** A string-to-string map from one field of a manifest, e.g. "scripts". */
export function stringMap(
  manifest: Manifest | undefined,
  field: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const value = manifest?.[field];
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") {
        map.set(key, entry);
      }
    }
  }
  return map;
}

export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Every dependency a manifest names, whichever field it's in. Moving one
 * between fields is neither adding nor removing it. */
export function allDependencies(
  manifest: Manifest | undefined,
): Map<string, string> {
  const all = new Map<string, string>();
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, spec] of stringMap(manifest, field)) {
      if (!all.has(name)) {
        all.set(name, spec);
      }
    }
  }
  return all;
}

export const TEMPLE_BAR_PACKAGE = "@londontypescript/temple-bar";

/** The temple-bar version a manifest pins, which decides what judges the
 * repository. */
export function pinnedTempleBar(
  manifest: Manifest | undefined,
): string | undefined {
  return (
    stringMap(manifest, "devDependencies").get(TEMPLE_BAR_PACKAGE) ??
    stringMap(manifest, "dependencies").get(TEMPLE_BAR_PACKAGE)
  );
}
