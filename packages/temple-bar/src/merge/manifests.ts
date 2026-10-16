// What a pull request changes, read once from git and shared by everything
// that judges it before the merge: the files it touches, each guarded
// path's state on both sides (what the judge compares), and each
// package.json it touches, parsed as it was before and after. Reading them
// here, rather than in each caller, means the maintainer-approval check
// and the "what you are approving" report can't disagree.

import type { Context } from "../context.ts";
import type { FileState, PathChange } from "../judge/file-state.ts";
import { isManifest } from "../judge/guarded-paths.ts";
import {
  parseManifest,
  TEMPLE_BAR_PACKAGE,
  type Manifest,
} from "../judge/manifests.ts";
import { changedPaths, readGuardedChanges } from "./guarded-states.ts";

export interface ManifestChange {
  /** Repository-relative, e.g. "package.json" or "packages/x/package.json". */
  readonly path: string;
  /** Undefined when the file didn't exist on that side, or couldn't be
   * read or parsed there. */
  readonly before: Manifest | undefined;
  readonly after: Manifest | undefined;
}

export interface PullRequestChanges {
  readonly files: readonly string[];
  /** Each guarded path the pull request changes, with its state on both
   * sides: what the judge's comparison reads. */
  readonly guarded: readonly PathChange[];
  readonly manifests: readonly ManifestChange[];
}

function parsed(state: FileState): Manifest | undefined {
  if (state.kind !== "regular" || state.text === undefined) {
    return undefined;
  }
  const manifest = parseManifest(state.text);
  return manifest.kind === "valid" ? manifest.value : undefined;
}

/** The files, guarded paths and package.json files changed between where
 * the pull request branched off (`base`) and its tip (`head`). */
export async function readChanges(
  ctx: Context,
  base: string,
  head: string,
  cwd: string,
): Promise<PullRequestChanges> {
  const files = await changedPaths(ctx, base, head, cwd);
  const guarded = await readGuardedChanges(ctx, base, head, files, cwd);
  const manifests = guarded
    .filter((change) => isManifest(change.path))
    .map((change) => ({
      path: change.path,
      before: parsed(change.base),
      after: parsed(change.head),
    }));
  return { files, guarded, manifests };
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

const DEPENDENCY_FIELDS = [
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
